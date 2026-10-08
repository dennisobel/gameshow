"""The generation graph, end to end, on the deterministic fake provider.

These tests are the reason the fake exists: without them, clustering, the board
gates, the revision loop and routing would only ever be exercised by spending
money against a live model.
"""

from __future__ import annotations

import re

import pytest

from app.config import Settings
from app.graph.build import build_graph
from app.graph.cluster import lexical_clusters, semantic_merge
from app.graph.personas import build_panel
from app.graph.pipeline import Pipeline
from app.models import JudgeVerdict, PanelWave, QuestionDrafts, SubtopicPlan
from app.providers.base import Usage
from app.providers.fake import FakeProvider
from app.providers.base import Provider


def settings(**overrides) -> Settings:
    base = dict(
        llm_provider="fake",
        panel_size=40,
        panel_concurrency=8,
        board_size=5,
        auto_approve=False,
        worker_enabled=False,
        min_judge_overall=3.0,
        min_judge_safety=4.0,
    )
    base.update(overrides)
    return Settings(**base)


# ---------------------------------------------------------------- personas

def test_panel_is_diverse_and_reproducible():
    a = build_panel("Name something people forget.", 40)
    b = build_panel("Name something people forget.", 40)
    assert a == b, "the same question must convene the same room"
    assert len(a) == 40
    assert len(set(a)) > 30, "a panel of clones would return one answer forty times"

    other = build_panel("Name a food people love.", 40)
    assert other != a, "different questions should not get an identical room"


# ---------------------------------------------------------------- clustering

def test_lexical_clustering_merges_phrasings():
    responses = ["keys", "my keys", "Keys", "car keys", "phone", "my phone", "wallet"]
    clusters = lexical_clusters(responses)
    by_text = {c.text.lower(): c for c in clusters}
    assert by_text["keys"].count == 4
    assert by_text["phone"].count == 2
    assert by_text["wallet"].count == 1
    # Sorted most popular first: this ordering becomes the board.
    assert clusters[0].count >= clusters[-1].count


def test_lexical_clustering_keeps_distinct_answers_apart():
    clusters = lexical_clusters(["tea", "coffee", "tea", "water"])
    assert len(clusters) == 3


def test_clustering_ignores_empty_responses():
    assert lexical_clusters(["", "   ", "!!!", "keys"]) == lexical_clusters(["keys"])


async def test_semantic_merge_folds_synonyms():
    """The whole reason for a second pass: "mobile" and "phone" are the same
    answer and share no letters."""
    clusters = lexical_clusters(["phone", "my mobile", "cell phone", "keys", "my keys"])
    assert len(clusters) >= 3  # lexical alone cannot merge these

    merged, _ = await semantic_merge(clusters, question="Q?", provider=FakeProvider())
    by_text = {c.text.lower(): c for c in merged}
    assert "phone" in by_text
    assert by_text["phone"].count == 3, f"expected phone variants merged, got {merged}"
    # Aliases are the raw phrasings people actually typed — that is what makes
    # them useful for matching during play.
    aliases = [a.lower() for a in by_text["phone"].aliases]
    assert any("mobile" in a for a in aliases), aliases


async def test_semantic_merge_degrades_when_the_model_fails():
    clusters = lexical_clusters(["phone", "keys", "wallet"])
    merged, _ = await semantic_merge(
        clusters, question="Q?", provider=FakeProvider(fail_schema="MergeResult")
    )
    assert merged == clusters, "a failed merge must keep the lexical clusters"


def test_aliases_exclude_the_canonical_text():
    clusters = lexical_clusters(["Keys", "keys", "my keys"])
    assert "keys" not in [a.lower() for a in clusters[0].aliases]
    assert "my keys" in [a.lower() for a in clusters[0].aliases]


# ------------------------------------------------------------------ panel

async def test_panel_produces_a_zipf_like_spread():
    pipeline = Pipeline(settings(panel_wave_size=20), FakeProvider())
    answers, usage = await pipeline.run_panel("Name something people forget.", 40)

    assert len(answers) == 40
    assert usage.calls == 2, "40 people in waves of 20 is two calls, not forty"
    clusters = lexical_clusters(answers)
    assert len(clusters) >= 4, "a usable board needs several distinct answers"
    assert clusters[0].count > clusters[-1].count, "answers should not be uniformly distributed"


async def test_panel_is_asked_in_waves_that_partition_the_people():
    """Every person is asked exactly once, in exactly one wave, and the wave's
    prompt lists exactly the people in it."""
    provider = FakeProvider()
    seen_prompts: list[str] = []
    original = provider.structured

    async def spy(**kwargs):
        if kwargs["schema"] is PanelWave:
            seen_prompts.append(kwargs["user"])
        return await original(**kwargs)

    provider.structured = spy  # type: ignore[method-assign]

    pipeline = Pipeline(settings(panel_wave_size=20), provider)
    answers, usage = await pipeline.run_panel("Name something people forget.", 50)

    assert usage.calls == 3  # 20 + 20 + 10
    assert len(answers) == 50
    counts = [len(re.findall(r"^\d+\. ", p, flags=re.MULTILINE)) for p in seen_prompts]
    assert sorted(counts) == [10, 20, 20]
    # No person appears in two waves.
    people = [line for p in seen_prompts for line in re.findall(r"^\d+\. (.+)$", p, flags=re.MULTILINE)]
    assert len(people) == len(set(people)) == 50


async def test_a_wave_size_of_one_is_one_call_per_person():
    """The setting that restores the original, independent-respondent design."""
    pipeline = Pipeline(settings(panel_wave_size=1), FakeProvider())
    answers, usage = await pipeline.run_panel("Name something people forget.", 12)
    assert usage.calls == 12 and len(answers) == 12


async def test_panel_tolerates_a_failed_wave():
    class Flaky(FakeProvider):
        def __init__(self):
            super().__init__()
            self.n = 0

        async def structured(self, **kwargs):
            if kwargs["schema"] is PanelWave:
                self.n += 1
                if self.n == 2:
                    raise RuntimeError("a wave never came back")
            return await super().structured(**kwargs)

    pipeline = Pipeline(settings(panel_wave_size=20), Flaky())
    answers, _ = await pipeline.run_panel("Name something people forget.", 60)
    assert len(answers) == 40, "two of three waves answered; the survey carries on without the third"


async def test_overlong_answers_are_dropped():
    """A respondent who writes an essay did not understand the brief."""

    class Rambling(FakeProvider):
        async def structured(self, **kwargs):
            if kwargs["schema"] is PanelWave:
                return PanelWave(answers=["keys", "x" * 80, "", "  phone  "]), Usage(calls=1)
            return await super().structured(**kwargs)

    answers, _ = await Pipeline(settings(), Rambling()).run_panel("Name something people forget.", 4)
    assert answers == ["keys", "phone"]


# ------------------------------------------------------------- whole graph

async def test_graph_produces_banked_questions():
    provider = FakeProvider()
    pipeline = Pipeline(settings(), provider)
    graph = build_graph(pipeline)

    final = await graph.ainvoke(
        {
            "category_slug": "everyday",
            "category_name": "Everyday Life",
            "category_tagline": "the stuff we all do",
            "locale": "en",
            "count": 3,
            "panel_size": 40,
            "existing_prompts": [],
            "results": [],
            "events": [],
            "usage": Usage(),
            "revisions_used": 0,
        },
        config={"recursion_limit": 25},
    )

    results = final["results"]
    assert results, "the graph produced nothing at all"

    kept = [r for r in results if r.status in ("approved", "review")]
    assert kept, f"nothing survived: {[(r.prompt, r.reject_reason) for r in results]}"

    for q in kept:
        assert q.prompt.startswith("Name ")
        assert len(q.board.answers) >= 4
        assert q.verdict is not None
        assert 0 < q.board.coverage <= 1.0
        assert q.difficulty in ("easy", "medium", "hard", "insane")
        # Points are measured, not invented.
        assert sum(a.count for a in q.board.answers) <= q.board.panel_size

    # Every node that ran left a trace behind.
    nodes = {e.node for e in final["events"]}
    assert {"plan", "write", "gate", "panel", "cluster", "board", "judge"} <= nodes

    # Usage accounting is wired through from every call, and attributes each one
    # to the role that made it.
    usage = final["usage"]
    assert usage.calls > 0
    assert sum(usage.by_model.values()) == usage.calls, "every call is booked against a model"
    assert {"fake-strong", "fake-judge", "fake-fast"} <= set(usage.by_model), "all three roles ran"


async def test_graph_is_reproducible():
    """Same input, same questions. Without this, nothing else here is a test."""

    async def run():
        pipeline = Pipeline(settings(), FakeProvider())
        graph = build_graph(pipeline)
        final = await graph.ainvoke(
            {
                "category_slug": "food",
                "category_name": "Food & Drink",
                "category_tagline": "strong opinions",
                "locale": "en",
                "count": 2,
                "panel_size": 30,
                "existing_prompts": [],
                "results": [],
                "events": [],
                "usage": Usage(),
                "revisions_used": 0,
            },
            config={"recursion_limit": 25},
        )
        return [(r.prompt, r.status, [a.text for a in r.board.answers]) for r in final["results"]]

    assert await run() == await run()


async def test_graph_rejects_a_question_already_in_the_bank():
    pipeline = Pipeline(settings(), FakeProvider())

    # Draft one question, then offer it back as an existing prompt.
    first = await pipeline.evaluate_one(
        "Name something people forget when they leave the house.", "", {"category_slug": "everyday"}
    )
    assert first[0].status != "rejected" or "existing" not in first[0].reject_reason

    duplicate, _, _ = await pipeline.evaluate_one(
        "Name something people forget when they leave the house.",
        "",
        {
            "category_slug": "everyday",
            "existing_prompts": ["Name something people forget when they leave the house."],
        },
    )
    assert duplicate.status == "rejected"
    assert "existing question" in duplicate.reject_reason


async def test_graph_rejects_a_near_rephrasing():
    pipeline = Pipeline(settings(), FakeProvider())
    result, _, _ = await pipeline.evaluate_one(
        "Name something people forget when leaving their house.",
        "",
        {
            "category_slug": "everyday",
            "existing_prompts": ["Name something people forget when they leave the house."],
        },
    )
    assert result.status == "rejected", "a rephrasing of a banked question must not get through"


async def test_malformed_drafts_never_reach_the_panel():
    """The gate is there to stop expensive work on obviously bad input."""
    provider = FakeProvider()
    pipeline = Pipeline(settings(), provider)
    result, usage, _ = await pipeline.evaluate_one("What is the capital of Peru?", "", {})
    assert result.status == "rejected"
    assert usage.calls == 0, "a question rejected at the gate must cost nothing"


async def test_revision_loop_runs_once_when_a_batch_fails():
    """Force every draft to fail the gate; the graph should revise once, then
    stop rather than loop."""

    class BadWriter(FakeProvider):
        async def structured(self, **kwargs):
            if kwargs["schema"] is QuestionDrafts:
                return QuestionDrafts(questions=[{"prompt": "What is the capital of Peru?"}]), Usage(calls=1)
            return await super().structured(**kwargs)

    pipeline = Pipeline(settings(), BadWriter())
    graph = build_graph(pipeline)
    final = await graph.ainvoke(
        {
            "category_slug": "everyday",
            "category_name": "Everyday Life",
            "count": 2,
            "panel_size": 20,
            "existing_prompts": [],
            "results": [],
            "events": [],
            "usage": Usage(),
            "revisions_used": 0,
        },
        config={"recursion_limit": 25},
    )
    assert final["revisions_used"] == 1, "exactly one revision attempt, then give up"
    assert all(r.status == "rejected" for r in final["results"])
    assert any(e.node == "revise" for e in final["events"])


async def test_unsafe_questions_are_rejected_by_the_judge():
    class UnsafeJudge(FakeProvider):
        async def structured(self, **kwargs):
            if kwargs["schema"] is JudgeVerdict:
                return (
                    JudgeVerdict(
                        fun=5, clarity=5, breadth=5, fairness=5, safety=2, overall=4,
                        reason="Not suitable for a family audience.",
                    ),
                    Usage(calls=1),
                )
            return await super().structured(**kwargs)

    pipeline = Pipeline(settings(), UnsafeJudge())
    result, _, _ = await pipeline.evaluate_one(
        "Name something people argue about at family gatherings.", "", {"category_slug": "everyday"}
    )
    assert result.status == "rejected"
    assert "Safety 2/5" in result.reject_reason


async def test_the_judge_is_not_the_writer():
    """Self-bias is real (ch. 3): a model grades its own output generously, so
    the judge must run on a different tier — and so a different model — from the
    one that wrote the question. The panel is the high-volume call and belongs on
    the cheap tier.

    This runs the whole graph so that the writer and the judge are both present;
    checking the judge alone cannot show that it differs from anything.
    """
    provider = FakeProvider()
    graph = build_graph(Pipeline(settings(), provider))
    await graph.ainvoke(
        {
            "category_slug": "everyday",
            "category_name": "Everyday Life",
            "count": 2,
            "panel_size": 20,
            "existing_prompts": [],
            "results": [],
            "events": [],
            "usage": Usage(),
            "revisions_used": 0,
        },
        config={"recursion_limit": 25},
    )

    tier_of = dict(provider.calls)
    assert "QuestionDrafts" in tier_of and "JudgeVerdict" in tier_of, "the graph never reached the judge"
    assert tier_of["QuestionDrafts"] == "strong"
    assert tier_of["JudgeVerdict"] == "judge"
    assert tier_of["JudgeVerdict"] != tier_of["QuestionDrafts"]
    assert tier_of["PanelWave"] == "fast"


async def test_a_failed_judge_does_not_bank_the_question():
    pipeline = Pipeline(settings(), FakeProvider(fail_schema="JudgeVerdict"))
    result, _, _ = await pipeline.evaluate_one(
        "Name something people forget at home.", "", {"category_slug": "x"}
    )
    assert result.status == "rejected"
    assert "judge" in result.reject_reason.lower()


async def test_auto_approve_setting_controls_routing():
    """Crawl-walk-run: the gate between review and the bank is configuration."""
    crawl = Pipeline(settings(auto_approve=False), FakeProvider())
    run = Pipeline(settings(auto_approve=True), FakeProvider())
    prompt = "Name something people forget when they leave the house."

    a, _, _ = await crawl.evaluate_one(prompt, "", {"category_slug": "x"})
    b, _, _ = await run.evaluate_one(prompt, "", {"category_slug": "x"})
    if a.status != "rejected":
        assert a.status == "review"
        assert b.status == "approved"


def test_provider_protocol_is_satisfied_by_the_fake():
    assert isinstance(FakeProvider(), Provider)


async def test_plan_falls_back_when_the_planner_fails():
    pipeline = Pipeline(settings(), FakeProvider(fail_schema="SubtopicPlan"))
    state = await pipeline.plan({"category_slug": "everyday", "count": 3})
    assert state["subtopics"], "a failed plan must not stop the batch"
    assert any(e.node == "plan" for e in state["events"])


def test_subtopic_plan_schema_bounds():
    with pytest.raises(Exception):
        SubtopicPlan(subtopics=[])
