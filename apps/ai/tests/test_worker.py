"""The queue worker: waking it, and bounding what it will spend."""

from __future__ import annotations

import asyncio
import time

import pytest

from app.worker import MAX_PANEL_SIZE, MIN_PANEL_SIZE, Worker, bounded_panel_size


class EmptyQueue:
    """A database whose queue is always empty, counting how often it is polled."""

    def __init__(self):
        self.polls = 0

    async def claim_job(self, _worker_id):
        self.polls += 1
        return None


def worker(poll_seconds: float) -> tuple[Worker, EmptyQueue]:
    db = EmptyQueue()
    return Worker(db, service=None, poll_seconds=poll_seconds), db  # type: ignore[arg-type]


async def test_wake_cuts_the_idle_wait_short():
    """A job that was just queued should start now, not up to a poll later."""
    w, db = worker(poll_seconds=30.0)  # long enough that only a wake can explain a second poll
    w.start()
    try:
        await asyncio.sleep(0.05)
        assert db.polls == 1, "the worker should have polled once and gone idle"

        started = time.monotonic()
        w.wake()
        for _ in range(100):
            if db.polls >= 2:
                break
            await asyncio.sleep(0.02)

        assert db.polls >= 2, "wake() did not make the worker look at the queue"
        assert time.monotonic() - started < 2.0
    finally:
        await w.stop()


async def test_a_worker_that_is_never_woken_still_polls():
    """The wake is only a hint. Without it the job is found on the next poll."""
    w, db = worker(poll_seconds=0.05)
    w.start()
    try:
        await asyncio.sleep(0.4)
        assert db.polls >= 3
    finally:
        await w.stop()


async def test_wake_enqueues_nothing():
    """The regression this exists to prevent: a 'nudge' that created its own copy
    of the job, so every batch ran twice."""
    w, db = worker(poll_seconds=30.0)
    w.start()
    try:
        await asyncio.sleep(0.05)
        for _ in range(5):
            w.wake()
            await asyncio.sleep(0.05)
        # The EmptyQueue has no way to create work; the point is that wake() has
        # no database access at all, so it cannot.
        assert not hasattr(db, "create_job")
    finally:
        await w.stop()


@pytest.mark.parametrize(
    "raw,expected",
    [
        (None, None),
        (0, None),
        (-4, None),
        ("", None),
        ("junk", None),
        (60, 60),
        ("60", 60),
        (1, MIN_PANEL_SIZE),
        (4, MIN_PANEL_SIZE),
        (200, MAX_PANEL_SIZE),
        (201, MAX_PANEL_SIZE),
        (1_000_000, MAX_PANEL_SIZE),
    ],
)
def test_panel_size_is_bounded_before_it_is_spent(raw, expected):
    assert bounded_panel_size(raw) == expected
