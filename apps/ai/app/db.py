"""Postgres access for the AI service.

The Go API owns the schema; this service reads categories and the existing bank,
and writes generated questions plus their provenance. Sharing one database is
deliberate — the job queue, the questions and the trace all have to agree, and
two stores could not.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from dataclasses import dataclass
from typing import Any

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

log = logging.getLogger(__name__)

_PUNCT = re.compile(r"[^\w\s]", flags=re.UNICODE)
_SPACE = re.compile(r"\s+")


def normalize_prompt(text: str) -> str:
    """Must agree with the Go seed loader and matcher: prompt_norm carries the
    uniqueness constraint, so a disagreement would let duplicates in."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace("'", "")
    text = _PUNCT.sub(" ", text)
    return _SPACE.sub(" ", text).strip()


@dataclass
class Category:
    id: str
    slug: str
    name: str
    tagline: str
    locale: str


class Database:
    def __init__(self, url: str):
        self._url = url
        self._pool: AsyncConnectionPool | None = None

    async def start(self) -> None:
        if self._pool is None:
            self._pool = AsyncConnectionPool(self._url, min_size=1, max_size=5, open=False)
            await self._pool.open(wait=True, timeout=30)

    async def aclose(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    def _require_pool(self) -> AsyncConnectionPool:
        if self._pool is None:
            raise RuntimeError("database pool not started")
        return self._pool

    async def ping(self) -> bool:
        try:
            async with self._require_pool().connection() as conn:
                await conn.execute("SELECT 1")
            return True
        except Exception as exc:  # noqa: BLE001
            log.warning("database ping failed: %s", exc)
            return False

    # ------------------------------------------------------------ catalog

    async def category(self, slug: str) -> Category | None:
        async with self._require_pool().connection() as conn:
            cur = await conn.cursor(row_factory=dict_row).execute(
                "SELECT id::text, slug, name, tagline, locale FROM categories WHERE slug = %s",
                (slug,),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return Category(
            id=row["id"], slug=row["slug"], name=row["name"],
            tagline=row["tagline"], locale=row["locale"],
        )

    async def categories(self) -> list[Category]:
        async with self._require_pool().connection() as conn:
            cur = await conn.cursor(row_factory=dict_row).execute(
                "SELECT id::text, slug, name, tagline, locale FROM categories "
                "WHERE is_active ORDER BY sort_order, name"
            )
            rows = await cur.fetchall()
        return [
            Category(id=r["id"], slug=r["slug"], name=r["name"], tagline=r["tagline"], locale=r["locale"])
            for r in rows
        ]

    async def existing_prompts(self, category_id: str, limit: int = 200) -> list[str]:
        """Questions already in this category, best first — they double as the
        writer's few-shot examples and as the lexical dedup set."""
        async with self._require_pool().connection() as conn:
            cur = await conn.execute(
                "SELECT prompt FROM questions WHERE category_id = %s "
                "AND status IN ('approved', 'review') "
                "ORDER BY quality_score DESC, created_at DESC LIMIT %s",
                (category_id, limit),
            )
            rows = await cur.fetchall()
        return [r[0] for r in rows]

    async def approved_questions(self, limit: int = 5000) -> list[dict[str, Any]]:
        """Every playable question, for rebuilding the vector index."""
        async with self._require_pool().connection() as conn:
            cur = await conn.cursor(row_factory=dict_row).execute(
                "SELECT q.id::text AS id, q.prompt, c.slug AS category, q.status::text AS status "
                "FROM questions q JOIN categories c ON c.id = q.category_id "
                "WHERE q.status IN ('approved', 'review') LIMIT %s",
                (limit,),
            )
            return list(await cur.fetchall())

    # ------------------------------------------------------------- writes

    async def insert_question(
        self,
        *,
        category_id: str,
        prompt: str,
        difficulty: str,
        status: str,
        panel_size: int,
        coverage: float,
        quality_score: float,
        judge_scores: dict[str, Any],
        generation_id: str | None,
        answers: list[dict[str, Any]],
    ) -> str | None:
        """Insert a question and its board. Returns None when the prompt is
        already in the bank — the unique index is the last line of defence
        behind the novelty node."""
        async with self._require_pool().connection() as conn:
            async with conn.transaction():
                cur = await conn.execute(
                    """
                    INSERT INTO questions (category_id, prompt, prompt_norm, difficulty, status,
                                           source, panel_size, panel_coverage, quality_score,
                                           judge_scores, generation_id)
                    VALUES (%s, %s, %s, %s, %s::question_status, 'ai', %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (category_id, prompt_norm) DO NOTHING
                    RETURNING id::text
                    """,
                    (
                        category_id, prompt, normalize_prompt(prompt), difficulty, status,
                        panel_size, coverage, quality_score, json.dumps(judge_scores),
                        generation_id,
                    ),
                )
                row = await cur.fetchone()
                if row is None:
                    return None
                question_id = row[0]

                for answer in answers:
                    await conn.execute(
                        """
                        INSERT INTO answers (question_id, rank, text, points, panel_count, share, aliases)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            question_id, answer["rank"], answer["text"], answer["points"],
                            answer["panel_count"], answer["share"], answer["aliases"],
                        ),
                    )
        return question_id

    # --------------------------------------------------------- job queue

    async def create_job(self, category_id: str | None, request: dict[str, Any]) -> str:
        async with self._require_pool().connection() as conn:
            cur = await conn.execute(
                "INSERT INTO generations (category_id, request, status) "
                "VALUES (%s, %s::jsonb, 'queued') RETURNING id::text",
                (category_id, json.dumps(request)),
            )
            row = await cur.fetchone()
        return row[0]

    async def start_job(self, category_id: str | None, request: dict[str, Any], worker_id: str) -> str:
        """Record a run that is already in progress, outside the queue.

        Created as 'running', never 'queued': a queued row is what the worker
        claims, so this one would run twice.
        """
        async with self._require_pool().connection() as conn:
            cur = await conn.execute(
                "INSERT INTO generations (category_id, request, status, started_at, locked_at, "
                "locked_by, attempts) VALUES (%s, %s::jsonb, 'running', now(), now(), %s, 1) "
                "RETURNING id::text",
                (category_id, json.dumps(request), worker_id),
            )
            row = await cur.fetchone()
        return row[0]

    async def claim_job(self, worker_id: str) -> dict[str, Any] | None:
        """Take the oldest queued job.

        FOR UPDATE SKIP LOCKED is what makes Postgres a correct queue: two
        workers polling at the same moment cannot take the same row, and a
        worker that dies mid-transaction releases its claim.
        """
        async with self._require_pool().connection() as conn:
            async with conn.transaction():
                cur = await conn.cursor(row_factory=dict_row).execute(
                    """
                    SELECT id::text AS id, category_id::text AS category_id, request, attempts
                      FROM generations
                     WHERE status = 'queued'
                     ORDER BY created_at
                     FOR UPDATE SKIP LOCKED
                     LIMIT 1
                    """
                )
                row = await cur.fetchone()
                if row is None:
                    return None
                await conn.execute(
                    "UPDATE generations SET status = 'running', started_at = now(), "
                    "locked_at = now(), locked_by = %s, attempts = attempts + 1 WHERE id = %s",
                    (worker_id, row["id"]),
                )
        return dict(row)

    async def finish_job(
        self,
        job_id: str,
        *,
        status: str,
        result: dict[str, Any],
        prompt_version: str = "",
        models: dict[str, Any] | None = None,
        tokens: dict[str, Any] | None = None,
        cost_usd: float = 0.0,
        latency_ms: int = 0,
        error: str = "",
    ) -> None:
        async with self._require_pool().connection() as conn:
            await conn.execute(
                """
                UPDATE generations
                   SET status = %s, result = %s::jsonb, prompt_version = %s,
                       models = %s::jsonb, tokens = %s::jsonb, cost_usd = %s,
                       latency_ms = %s, error = %s, finished_at = now()
                 WHERE id = %s
                """,
                (
                    status, json.dumps(result), prompt_version,
                    json.dumps(models or {}), json.dumps(tokens or {}), cost_usd,
                    latency_ms, error[:2000], job_id,
                ),
            )

    async def add_events(self, job_id: str, events: list[dict[str, Any]]) -> None:
        if not events:
            return
        async with self._require_pool().connection() as conn:
            async with conn.cursor() as cur:
                await cur.executemany(
                    "INSERT INTO generation_events (generation_id, node, status, detail, latency_ms) "
                    "VALUES (%s, %s, %s, %s::jsonb, %s)",
                    [
                        (job_id, e["node"], e["status"], json.dumps(e.get("detail", {})), e.get("latency_ms", 0))
                        for e in events
                    ],
                )

    async def review_queue(self, limit: int = 20) -> list[dict[str, Any]]:
        async with self._require_pool().connection() as conn:
            cur = await conn.cursor(row_factory=dict_row).execute(
                """
                SELECT q.id::text AS id, c.slug AS category, q.prompt, q.difficulty,
                       q.panel_coverage, q.quality_score, q.judge_scores,
                       (SELECT json_agg(json_build_object('rank', a.rank, 'text', a.text,
                                                          'points', a.points) ORDER BY a.rank)
                          FROM answers a WHERE a.question_id = q.id) AS answers
                  FROM questions q JOIN categories c ON c.id = q.category_id
                 WHERE q.status = 'review'
                 ORDER BY q.quality_score DESC, q.created_at
                 LIMIT %s
                """,
                (limit,),
            )
            return list(await cur.fetchall())


async def connect(url: str) -> AsyncConnection:  # pragma: no cover - convenience for scripts
    return await AsyncConnection.connect(url, row_factory=dict_row)
