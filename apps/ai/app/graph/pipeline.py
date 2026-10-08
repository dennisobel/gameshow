"""The generation pipeline.

plan -> write -> gate -> novelty -> panel -> cluster -> board -> judge -> route

The graph is wired in `build.py` with LangGraph; this module holds the work each
node does, as plain async functions over `GraphState`. Keeping them plain means
they can be called and tested one at a time, which is what ch. 4 asks for when
it says to evaluate every component independently as well as end to end.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Sequence
from typing import TypeVar

from app.config import Settings
from app.graph.board import build_board, check_board, difficulty_for
from app.graph.cluster import lexical_clusters, semantic_merge
from app.graph.gate import check_format
from app.graph.personas import build_panel
from app.graph.state import GraphState, TraceEvent
from app.graph.text import content_tokens, jaccard, normalize
from app.models import (
    Board,
    GeneratedQuestion,
    JudgeVerdict,
    PanelWave,
    QuestionDrafts,
    Subtopic,
    SubtopicPlan,
)
from app.prompts.registry import render
from app.providers.base import Provider, ProviderError, Usage
from app.retrieval.index import QuestionIndex

log = logging.getLogger(__name__)

T = TypeVar("T")

MAX_REVISIONS = 1  # bounded: reflection helps, loops compound error (ch. 6)


def _locale_note(locale: str) -> str:
    if locale and locale != "en":
        return f"Write for a {locale} audience: use references and phrasing that feel local, not imported."
    return ""


async def _bounded_gather(
    factories: Sequence[Callable[[], Awaitable[T]]], concurrency: int
) -> list[T | BaseException]:
    """Run coroutines with a ceiling on how many are in flight."""
    semaphore = asyncio.Semaphore(max(1, concurrency))

    async def run(factory: Callable[[], Awaitable[T]]) -> T:
        async with semaphore:
            return await factory()

    return await asyncio.gather(*(run(f) for f in factories), return_exceptions=True)


class Pipeline:
    def __init__(self, settings: Settings, provider: Provider, index: QuestionIndex | None = None):
        self.settings = settings
        self.provider = provider
        self.index = index

    # --------------------------------------------------------------- plan

    async def plan(self, state: GraphState) -> GraphState:
        """Expand the category into angles, so a batch covers it instead of
        circling one idea (ch. 8: topic -> subtopic for coverage)."""
        started = time.monotonic()
        usage = state.get("usage") or Usage()
        events = list(state.get("events") or [])

        if state.get("requested_subtopic"):
            subtopics = [Subtopic(name=state["requested_subtopic"], angle="as requested")]
        else:
            try:
                plan, call_usage = await self.provider.structured(
                    system=render("plan_system"),
                    user=render(
                        "plan_user",
                        category=state.get("category_name", state["category_slug"]),
                        category_tagline=state.get("category_tagline", ""),
                        locale_note=_locale_note(state.get("locale", "en")),
                        existing="\n".join(f"- {p}" for p in state.get("existing_prompts", [])[:15])
                        or "- (none yet)",
                        count=max(3, min(8, state.get("count", 3))),
                    ),
                    schema=SubtopicPlan,
                    tier="strong",
                    temperature=1.0,
                )
                usage.add(call_usage)
                subtopics = plan.subtopics
            except Exception as exc:  # noqa: BLE001 - a missing plan is not fatal
                log.warning("plan failed, falling back to a single generic angle: %s", exc)
                subtopics = [Subtopic(name="general", angle="everyday situations")]

        events.append(
            TraceEvent(
                node="plan",
                status="ok",
                detail={"subtopics": [s.name for s in subtopics]},
                latency_ms=int((time.monotonic() - started) * 1000),
            )
        )
        return {**state, "subtopics": subtopics, "usage": usage, "events": events}

    # -------------------------------------------------------------- write

    async def write(self, state: GraphState) -> GraphState:
        """Draft candidate questions, one batch per angle, in parallel."""
        started = time.monotonic()
        usage = state.get("usage") or Usage()
        events = list(state.get("events") or [])
        subtopics = state.get("subtopics") or [Subtopic(name="general", angle="everyday situations")]

        wanted = max(1, state.get("count", 3))
        per_subtopic = max(1, -(-wanted // len(subtopics)))  # ceiling division
        examples = await self._examples(state)

        async def draft(subtopic: Subtopic):
            return await self.provider.structured(
                system=render("writer_system"),
                user=render(
                    "writer_user",
                    category=state.get("category_name", state["category_slug"]),
                    category_tagline=state.get("category_tagline", ""),
                    subtopic=subtopic.name,
                    subtopic_angle=subtopic.angle,
                    locale_note=_locale_note(state.get("locale", "en")),
                    existing=examples or "- (none yet)",
                    feedback=state.get("revision_feedback", ""),
                    count=per_subtopic,
                ),
                schema=QuestionDrafts,
                tier="strong",
                temperature=1.0,
            )

        outcomes = await _bounded_gather(
            [lambda s=s: draft(s) for s in subtopics], self.settings.panel_concurrency
        )

        drafts: list[str] = []
        pairing: list[str] = []
        failures = 0
        for subtopic, outcome in zip(subtopics, outcomes, strict=False):
            if isinstance(outcome, BaseException):
                failures += 1
                log.warning("writer failed for %s: %s", subtopic.name, outcome)
                continue
            result, call_usage = outcome
            usage.add(call_usage)
            for q in result.questions:
                drafts.append(" ".join(q.prompt.split()))
                pairing.append(subtopic.name)

        # Drop exact repeats inside the batch before spending anything on them.
        seen: set[str] = set()
        unique: list[str] = []
        unique_subtopics: list[str] = []
        for prompt, subtopic in zip(drafts, pairing, strict=False):
            key = normalize(prompt)
            if key in seen:
                continue
            seen.add(key)
            unique.append(prompt)
            unique_subtopics.append(subtopic)

        events.append(
            TraceEvent(
                node="write",
                status="ok" if unique else "empty",
                detail={"drafted": len(drafts), "unique": len(unique), "failures": failures},
                latency_ms=int((time.monotonic() - started) * 1000),
            )
        )
        return {
            **state,
            "drafts": unique[: wanted * 2],
            "draft_subtopics": unique_subtopics[: wanted * 2],
            "usage": usage,
            "events": events,
        }

    async def _examples(self, state: GraphState) -> str:
        """Few-shot examples, retrieved rather than hardcoded: the best existing
        questions in this category (ch. 5, ch. 6)."""
        prompts = list(state.get("existing_prompts") or [])
        return "\n".join(f"- {p}" for p in prompts[:15])

    # ------------------------------------------------- per-candidate work

    async def evaluate(self, state: GraphState) -> GraphState:
        """Run every surviving draft through gate -> novelty -> panel ->
        cluster -> board -> judge -> route."""
        usage = state.get("usage") or Usage()
        events = list(state.get("events") or [])
        results = list(state.get("results") or [])

        drafts = state.get("drafts") or []
        subtopics = state.get("draft_subtopics") or [""] * len(drafts)
        wanted = max(1, state.get("count", 3))

        accepted = 0
        for prompt, subtopic in zip(drafts, subtopics, strict=False):
            if accepted >= wanted:
                break
            outcome, call_usage, node_events = await self.evaluate_one(prompt, subtopic, state)
            usage.add(call_usage)
            events.extend(node_events)
            results.append(outcome)
            if outcome.status in ("approved", "review"):
                accepted += 1

        return {**state, "results": results, "usage": usage, "events": events}

    async def evaluate_one(
        self, prompt: str, subtopic: str, state: GraphState
    ) -> tuple[GeneratedQuestion, Usage, list[TraceEvent]]:
        usage = Usage()
        events: list[TraceEvent] = []
        empty = Board(answers=[], panel_size=0, coverage=0.0, top_share=0.0)

        def rejected(reason: str, node: str) -> GeneratedQuestion:
            events.append(TraceEvent(node=node, status="rejected", detail={"prompt": prompt, "reason": reason}))
            return GeneratedQuestion(
                prompt=prompt, board=empty, status="rejected", reject_reason=reason, subtopic=subtopic
            )

        # --- gate: free checks first
        started = time.monotonic()
        if reason := check_format(prompt):
            return rejected(reason, "gate"), usage, events
        events.append(
            TraceEvent(node="gate", status="ok", detail={"prompt": prompt},
                       latency_ms=int((time.monotonic() - started) * 1000))
        )

        # --- novelty: do we already have this question?
        started = time.monotonic()
        duplicate = await self._find_duplicate(prompt, state)
        if duplicate:
            return rejected(f"Too close to an existing question: {duplicate!r}", "novelty"), usage, events
        events.append(
            TraceEvent(node="novelty", status="ok", latency_ms=int((time.monotonic() - started) * 1000))
        )

        # --- panel: the survey itself
        started = time.monotonic()
        panel_size = state.get("panel_size") or self.settings.panel_size
        responses, panel_usage = await self.run_panel(prompt, panel_size)
        usage.add(panel_usage)
        if len(responses) < max(10, panel_size // 3):
            return rejected(
                f"The panel only returned {len(responses)} of {panel_size} answers.", "panel"
            ), usage, events
        events.append(
            TraceEvent(node="panel", status="ok",
                       detail={"asked": panel_size, "answered": len(responses)},
                       latency_ms=int((time.monotonic() - started) * 1000))
        )

        # --- cluster: raw answers -> board answers
        started = time.monotonic()
        clusters = lexical_clusters(responses)
        clusters, merge_usage = await semantic_merge(clusters, question=prompt, provider=self.provider)
        usage.add(merge_usage)
        events.append(
            TraceEvent(node="cluster", status="ok",
                       detail={"raw": len(responses), "clusters": len(clusters)},
                       latency_ms=int((time.monotonic() - started) * 1000))
        )

        # --- board: measure whether it is playable
        board = build_board(clusters, len(responses), self.settings.board_size)
        if reason := check_board(
            board,
            min_coverage=self.settings.min_coverage,
            max_top_share=self.settings.max_top_share,
            min_clusters=self.settings.min_clusters,
        ):
            return rejected(reason, "board"), usage, events
        events.append(
            TraceEvent(node="board", status="ok",
                       detail={"coverage": board.coverage, "top_share": board.top_share,
                               "answers": [a.text for a in board.answers]})
        )

        # --- judge: a second opinion, from a different model than the writer
        started = time.monotonic()
        verdict, judge_usage = await self.judge(prompt, board, state)
        usage.add(judge_usage)
        if verdict is None:
            return rejected("The judge could not be reached.", "judge"), usage, events
        events.append(
            TraceEvent(node="judge", status="ok",
                       detail={"overall": verdict.overall, "safety": verdict.safety,
                               "reason": verdict.reason},
                       latency_ms=int((time.monotonic() - started) * 1000))
        )

        # --- route
        if verdict.safety < self.settings.min_judge_safety:
            return rejected(f"Safety {verdict.safety}/5: {verdict.reason}", "route"), usage, events
        if verdict.overall < self.settings.min_judge_overall:
            return rejected(f"Scored {verdict.overall}/5: {verdict.reason}", "route"), usage, events

        status = "approved" if self.settings.auto_approve else "review"
        events.append(TraceEvent(node="route", status=status, detail={"prompt": prompt}))
        return (
            GeneratedQuestion(
                prompt=prompt,
                difficulty=difficulty_for(board),
                board=board,
                verdict=verdict,
                status=status,
                subtopic=subtopic,
            ),
            usage,
            events,
        )

    # -------------------------------------------------------------- panel

    async def run_panel(self, question: str, size: int) -> tuple[list[str], Usage]:
        """Put the question to `size` simulated people, a wave at a time.

        The people are split into waves and each wave is one call that imagines
        those people answering in turn. That is deliberate: the obvious design,
        one independent call per person, collapses onto the modal answer however
        different the personas are — against the live model, "Fish" was 60 of 60
        for a question whose real answers are fish, garlic, curry and onions.
        A model that sees it has already said "stage" eight times varies on its
        own. `panel_wave_size=1` restores one-call-per-person.

        Failures are tolerated: a survey with a few non-responses is still a
        survey, and the caller checks the response rate.
        """
        usage = Usage()
        personas = build_panel(question, size)
        wave_size = max(1, self.settings.panel_wave_size)
        waves = [personas[i : i + wave_size] for i in range(0, len(personas), wave_size)]
        system = render("panel_system")

        async def ask(group: list[str]):
            people = "\n".join(f"{n}. {p}" for n, p in enumerate(group, start=1))
            return await self.provider.structured(
                system=system,
                user=render("panel_user", question=question, count=len(group), people=people),
                schema=PanelWave,
                tier="fast",
                temperature=1.0,
                # Room for a few words each. If it is not enough the provider
                # retries with a larger budget rather than failing the wave.
                max_tokens=max(256, 30 * len(group)),
            )

        outcomes = await _bounded_gather(
            [lambda g=g: ask(g) for g in waves], self.settings.panel_concurrency
        )

        answers: list[str] = []
        for outcome in outcomes:
            if isinstance(outcome, BaseException):
                continue
            wave, call_usage = outcome
            usage.add(call_usage)
            for raw in wave.answers:
                text = " ".join(raw.split())
                # A respondent who writes an essay did not understand the brief.
                if text and len(text) <= 48:
                    answers.append(text)
        return answers, usage

    # -------------------------------------------------------------- judge

    async def judge(self, prompt: str, board: Board, state: GraphState) -> tuple[JudgeVerdict | None, Usage]:
        usage = Usage()
        listing = "\n".join(
            f"{i + 1}. {a.text} — {a.count} of {board.panel_size}" for i, a in enumerate(board.answers)
        )
        try:
            verdict, call_usage = await self.provider.structured(
                system=render("judge_system"),
                user=render(
                    "judge_user",
                    category=state.get("category_name", state.get("category_slug", "")),
                    question=prompt,
                    panel_size=board.panel_size,
                    board=listing,
                    coverage_pct=round(board.coverage * 100),
                    top_pct=round(board.top_share * 100),
                ),
                schema=JudgeVerdict,
                # Its own tier, so it runs on a different model from the writer:
                # a model grades its own output generously (ch. 3, self-bias).
                tier="judge",
                # Low temperature: a judge should be as reproducible as we can
                # make it, or its scores cannot be compared over time (ch. 3).
                temperature=0.2,
            )
            usage.add(call_usage)
            return verdict, usage
        except ProviderError as exc:
            log.warning("judge failed for %r: %s", prompt, exc)
            return None, usage
        except Exception as exc:  # noqa: BLE001
            log.warning("judge errored for %r: %s", prompt, exc)
            return None, usage

    # ------------------------------------------------------------ novelty

    async def _find_duplicate(self, prompt: str, state: GraphState) -> str | None:
        """Hybrid search against the bank, with a lexical fallback.

        Qdrant being down degrades dedup to trigram-style overlap rather than
        stopping generation (ARCHITECTURE §9).
        """
        if self.index is not None:
            try:
                hit = await self.index.find_duplicate(prompt, category=state.get("category_slug", ""))
                if hit:
                    return hit
            except Exception as exc:  # noqa: BLE001
                log.warning("index unavailable, falling back to lexical dedup: %s", exc)

        tokens = content_tokens(prompt)
        for existing in state.get("existing_prompts") or []:
            if normalize(existing) == normalize(prompt):
                return existing
            if jaccard(tokens, content_tokens(existing)) >= 0.7:
                return existing
        return None
