"""FastAPI app for the AI service.

Internal only. The browser never reaches this service; the Go API calls it with
a shared token (ARCHITECTURE §3).
"""

from __future__ import annotations

import logging
import secrets
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.db import Database
from app.providers import build_provider
from app.retrieval.index import QuestionIndex
from app.service import GenerationService
from app.worker import Worker

log = logging.getLogger(__name__)


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)

    db = Database(settings.psycopg_url)
    await db.start()

    index = QuestionIndex(settings.qdrant_url, settings.qdrant_collection)
    try:
        await index.ensure()
    except Exception as exc:  # noqa: BLE001
        # Dedup degrades to lexical comparison; generation still works.
        log.warning("qdrant unavailable, continuing without the vector index: %s", exc)

    provider = build_provider(settings)
    service = GenerationService(settings, db, provider, index)

    worker = Worker(db, service, settings.worker_poll_seconds)
    if settings.worker_enabled:
        worker.start()

    app.state.settings = settings
    app.state.db = db
    app.state.index = index
    app.state.provider = provider
    app.state.service = service
    app.state.worker = worker

    try:
        yield
    finally:
        await worker.stop()
        await provider.aclose()
        await index.aclose()
        await db.aclose()


app = FastAPI(
    title="On The Board — generation service",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
)


def require_internal_token(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Shared-secret auth between the Go API and this service."""
    settings: Settings = request.app.state.settings
    expected = settings.internal_token
    supplied = ""
    if authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    # Constant-time: this endpoint can start work that costs money.
    if not expected or not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="bad internal token")


# ------------------------------------------------------------------ health

@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz")
async def readyz(request: Request) -> dict[str, object]:
    db: Database = request.app.state.db
    settings: Settings = request.app.state.settings
    database_ok = await db.ping()
    body = {
        "status": "ok" if database_ok else "degraded",
        "database": "ok" if database_ok else "unreachable",
        "provider": request.app.state.provider.name,
        # Which model plays which role. Never the key.
        "models": settings.models if request.app.state.provider.name != "fake" else {},
        "worker": settings.worker_enabled,
        "panelSize": settings.panel_size,
        "autoApprove": settings.auto_approve,
    }
    if not database_ok:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=body)
    return body


# -------------------------------------------------------------- generation

class GenerateRequest(BaseModel):
    category: str
    count: int = Field(default=3, ge=1, le=25)
    subtopic: str = ""
    panel_size: int | None = Field(default=None, ge=5, le=200)
    # Wait for the result instead of queueing it. Useful from the CLI and in
    # tests; the API always queues.
    inline: bool = False


@app.post("/internal/generate", dependencies=[Depends(require_internal_token)])
async def generate(request: Request, body: GenerateRequest) -> dict[str, object]:
    db: Database = request.app.state.db
    service: GenerationService = request.app.state.service

    category = await db.category(body.category)
    if category is None:
        raise HTTPException(status_code=404, detail=f"unknown category: {body.category}")

    if body.inline:
        report = await service.run(
            category_slug=body.category,
            count=body.count,
            subtopic=body.subtopic,
            panel_size=body.panel_size,
        )
        return {"status": "succeeded", "report": report.to_dict()}

    job_id = await db.create_job(
        category.id,
        {
            "category": body.category,
            "count": body.count,
            "subtopic": body.subtopic,
            "panel_size": body.panel_size,
        },
    )
    return {"generation_id": job_id, "status": "queued"}


@app.post("/internal/wake", dependencies=[Depends(require_internal_token)])
async def wake(request: Request) -> dict[str, bool]:
    """Tell the worker to look at the queue now.

    This does not enqueue anything. The Go API writes the job row; this only makes
    the worker notice it without waiting out its poll interval.
    """
    request.app.state.worker.wake()
    return {"woken": True}


@app.get("/internal/review", dependencies=[Depends(require_internal_token)])
async def review(request: Request, limit: int = 20) -> dict[str, object]:
    db: Database = request.app.state.db
    return {"questions": await db.review_queue(min(max(limit, 1), 200))}


@app.post("/internal/reindex", dependencies=[Depends(require_internal_token)])
async def reindex(request: Request) -> dict[str, int]:
    service: GenerationService = request.app.state.service
    return {"indexed": await service.reindex()}
