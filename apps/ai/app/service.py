"""Running a generation: from a job row to banked questions.

This is the layer between the graph (which knows nothing about storage) and the
database (which knows nothing about models).
"""

from __future__ import annotations

import logging
import time
from dataclasses import asdict, dataclass, field
from typing import Any

from app.config import Settings
from app.db import Database
from app.graph.board import points_for
from app.graph.build import build_graph
from app.graph.pipeline import Pipeline
from app.models import GeneratedQuestion
from app.prompts.registry import PROMPT_VERSION
from app.providers.base import Provider, Usage
from app.retrieval.index import QuestionIndex

log = logging.getLogger(__name__)


@dataclass
class RunReport:
    category: str
    requested: int
    approved: int = 0
    queued_for_review: int = 0
    rejected: int = 0
    duplicates: int = 0
    rejections: list[dict[str, str]] = field(default_factory=list)
    questions: list[dict[str, Any]] = field(default_factory=list)
    cost_usd: float = 0.0
    latency_ms: int = 0
    tokens: dict[str, int] = field(default_factory=dict)
    models: dict[str, int] = field(default_factory=dict)
    provider: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class GenerationService:
    def __init__(
        self,
        settings: Settings,
        db: Database,
        provider: Provider,
        index: QuestionIndex | None = None,
    ):
        self.settings = settings
        self.db = db
        self.provider = provider
        self.index = index
        self.pipeline = Pipeline(settings, provider, index)
        self.graph = build_graph(self.pipeline)

    async def run(
        self,
        *,
        category_slug: str,
        count: int = 3,
        subtopic: str = "",
        panel_size: int | None = None,
        job_id: str | None = None,
    ) -> RunReport:
        """Run one generation, with a provenance row whichever way it started.

        A queued job arrives with its row (`job_id`). A run started directly —
        the CLI, or the inline endpoint — has none, and used to leave no record of
        what it cost or what it produced, which contradicts the promise that every
        banked question can be traced. So it gets a row of its own, recorded as
        already running (never as queued, or the worker would claim it and run
        the batch a second time).
        """
        category = await self.db.category(category_slug)
        if category is None:
            raise ValueError(f"unknown category: {category_slug}")

        started = time.monotonic()
        opened_here = job_id is None
        if opened_here:
            job_id = await self.db.start_job(
                category.id,
                {"category": category_slug, "count": count, "subtopic": subtopic, "panel_size": panel_size},
                worker_id="inline",
            )

        try:
            return await self._execute(
                category, count=count, subtopic=subtopic, panel_size=panel_size, job_id=job_id
            )
        except Exception as exc:
            # A job the worker owns is settled by the worker, which knows about
            # retries. One opened here has nobody else to close it.
            if opened_here:
                await self.db.finish_job(
                    job_id,
                    status="failed",
                    result={},
                    prompt_version=PROMPT_VERSION,
                    latency_ms=int((time.monotonic() - started) * 1000),
                    error=str(exc),
                )
            raise

    async def _execute(
        self,
        category,
        *,
        count: int,
        subtopic: str,
        panel_size: int | None,
        job_id: str,
    ) -> RunReport:
        started = time.monotonic()
        existing = await self.db.existing_prompts(category.id)
        report = RunReport(category=category.slug, requested=count, provider=self.provider.name)

        state = {
            "category_slug": category.slug,
            "category_name": category.name,
            "category_tagline": category.tagline,
            "locale": category.locale,
            "count": count,
            "requested_subtopic": subtopic,
            "panel_size": panel_size or self.settings.panel_size,
            "existing_prompts": existing,
            "results": [],
            "events": [],
            "usage": Usage(),
            "revisions_used": 0,
        }

        # The graph may run several model calls per node; give it room rather
        # than tripping LangGraph's default recursion guard mid-batch.
        final = await self.graph.ainvoke(state, config={"recursion_limit": 25})

        usage: Usage = final.get("usage") or Usage()
        results: list[GeneratedQuestion] = final.get("results") or []

        for result in results:
            if result.status == "rejected":
                report.rejected += 1
                report.rejections.append({"prompt": result.prompt, "reason": result.reject_reason})
                if "existing question" in result.reject_reason:
                    report.duplicates += 1
                continue

            question_id = await self._persist(result, category.id, job_id)
            if question_id is None:
                # Lost a race with the unique index: another run banked it first.
                report.duplicates += 1
                report.rejections.append(
                    {"prompt": result.prompt, "reason": "Already in the bank (insert raced)."}
                )
                continue

            if result.status == "approved":
                report.approved += 1
            else:
                report.queued_for_review += 1

            report.questions.append(
                {
                    "id": question_id,
                    "prompt": result.prompt,
                    "status": result.status,
                    "difficulty": result.difficulty,
                    "coverage": result.board.coverage,
                    "top_share": result.board.top_share,
                    "answers": [
                        {"text": a.text, "panel_count": a.count,
                         "points": points_for(a, result.board.panel_size)}
                        for a in result.board.answers
                    ],
                    "judge": result.verdict.model_dump() if result.verdict else None,
                }
            )

            if self.index is not None:
                try:
                    await self.index.add(
                        question_id=question_id,
                        prompt=result.prompt,
                        category=category.slug,
                        status=result.status,
                    )
                except Exception as exc:  # noqa: BLE001 - indexing is best effort
                    log.warning("could not index %s: %s", question_id, exc)

        report.cost_usd = round(usage.cost_usd, 6)
        report.latency_ms = int((time.monotonic() - started) * 1000)
        report.tokens = {
            "input": usage.input_tokens,
            "output": usage.output_tokens,
            "cache_read": usage.cache_read_tokens,
            "reasoning": usage.reasoning_tokens,
            "calls": usage.calls,
            # Non-zero means cost_usd is a lower bound: those calls ran on a model
            # whose price is not in the table.
            "unpriced_calls": usage.unpriced_calls,
        }
        report.models = dict(usage.by_model)

        await self.db.add_events(
            job_id,
            [
                {"node": e.node, "status": e.status, "detail": e.detail, "latency_ms": e.latency_ms}
                for e in (final.get("events") or [])
            ],
        )
        await self.db.finish_job(
            job_id,
            status="succeeded",
            result=report.to_dict(),
            prompt_version=PROMPT_VERSION,
            models=report.models,
            tokens=report.tokens,
            cost_usd=report.cost_usd,
            latency_ms=report.latency_ms,
        )

        log.info(
            "generation finished: category=%s approved=%d review=%d rejected=%d cost=$%.4f in %dms",
            category.slug, report.approved, report.queued_for_review,
            report.rejected, report.cost_usd, report.latency_ms,
        )
        return report

    async def _persist(
        self, result: GeneratedQuestion, category_id: str, job_id: str | None
    ) -> str | None:
        board = result.board
        answers = [
            {
                "rank": i + 1,
                "text": cluster.text,
                "points": points_for(cluster, board.panel_size),
                "panel_count": cluster.count,
                "share": round(cluster.count / max(1, board.panel_size), 3),
                "aliases": cluster.aliases,
            }
            for i, cluster in enumerate(board.answers)
        ]
        judge = result.verdict.model_dump() if result.verdict else {}
        quality = float(result.verdict.overall) if result.verdict else 0.0

        return await self.db.insert_question(
            category_id=category_id,
            prompt=result.prompt,
            difficulty=result.difficulty,
            status=result.status,
            panel_size=board.panel_size,
            coverage=board.coverage,
            quality_score=quality,
            judge_scores=judge,
            generation_id=job_id,
            answers=answers,
        )

    async def reindex(self) -> int:
        """Rebuild the vector index from Postgres, which is the source of truth."""
        if self.index is None:
            return 0
        await self.index.ensure()
        rows = await self.db.approved_questions()
        for row in rows:
            await self.index.add(
                question_id=row["id"],
                prompt=row["prompt"],
                category=row["category"],
                status=row["status"],
            )
        log.info("reindexed %d questions", len(rows))
        return len(rows)
