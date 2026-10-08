"""Background worker: drains the generation queue.

Jobs are rows in Postgres, claimed with FOR UPDATE SKIP LOCKED. That means the
API can enqueue work and return immediately, a job survives a restart of this
service, and several workers can run without coordinating.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import socket
import time

from app.db import Database
from app.service import GenerationService

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3

# Every respondent is a billed model call, so the panel size is a direct
# multiplier on spend. The API validates it too, but this is the layer that
# actually pays, so it does not trust what is in the row.
MIN_PANEL_SIZE = 5
MAX_PANEL_SIZE = 200


def bounded_panel_size(raw: object) -> int | None:
    """None means "use the configured default"."""
    try:
        size = int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if size <= 0:
        return None
    return max(MIN_PANEL_SIZE, min(MAX_PANEL_SIZE, size))


class Worker:
    def __init__(self, db: Database, service: GenerationService, poll_seconds: float = 5.0):
        self.db = db
        self.service = service
        self.poll_seconds = poll_seconds
        self.worker_id = f"{socket.gethostname()}:{os.getpid()}"
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._wake = asyncio.Event()

    def wake(self) -> None:
        """Cut the idle wait short so a job that was just queued starts now.

        This is only ever a hint. The job is a row in Postgres and the worker
        would find it on its next poll anyway, so a wake that is lost, late, or
        never sent costs a few seconds and nothing else. It must never create
        work of its own: an earlier version "nudged" by enqueueing a second copy
        of the job, which ran every batch twice.
        """
        self._wake.set()

    def start(self) -> None:
        if self._task is None:
            self._stop.clear()
            self._task = asyncio.create_task(self._loop(), name="generation-worker")
            log.info("worker started (%s)", self.worker_id)

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                worked = await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - a worker must not die
                log.exception("worker iteration failed: %s", exc)
                worked = False

            if not worked:
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(self._wake.wait(), timeout=self.poll_seconds)
                self._wake.clear()

    async def run_once(self) -> bool:
        """Claim and run one job. Returns False when the queue is empty."""
        job = await self.db.claim_job(self.worker_id)
        if job is None:
            return False

        job_id = job["id"]
        request = job.get("request") or {}
        attempts = job.get("attempts", 0) + 1
        started = time.monotonic()
        log.info("running generation %s (attempt %d): %s", job_id, attempts, request)

        try:
            await self.service.run(
                category_slug=request.get("category", ""),
                count=int(request.get("count") or 3),
                subtopic=request.get("subtopic") or "",
                panel_size=bounded_panel_size(request.get("panel_size")),
                job_id=job_id,
            )
        except Exception as exc:  # noqa: BLE001
            # Exhausted retries fail the job for good; otherwise put it back so a
            # transient provider outage does not lose the work.
            final = attempts >= MAX_ATTEMPTS
            log.exception("generation %s failed (attempt %d/%d)", job_id, attempts, MAX_ATTEMPTS)
            await self.db.finish_job(
                job_id,
                status="failed" if final else "queued",
                result={},
                latency_ms=int((time.monotonic() - started) * 1000),
                error=str(exc),
            )
        return True
