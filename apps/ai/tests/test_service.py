"""GenerationService: what gets persisted, and what provenance is written.

The graph itself is covered in test_pipeline.py. This is the layer around it that
decides which results become banked questions and makes sure every run — queued
or direct — leaves a record of what it did and what it cost.
"""

from __future__ import annotations

import pytest

from app.config import Settings
from app.db import Category
from app.providers.fake import FakeProvider
from app.service import GenerationService


class StubDB:
    def __init__(self, existing: list[str] | None = None, fail_on_existing: bool = False):
        self.category_row = Category(id="cat-1", slug="everyday", name="Everyday Life", tagline="", locale="en")
        self._existing = existing or []
        self._fail = fail_on_existing
        self.started: list[dict] = []
        self.finished: list[tuple[str, dict]] = []
        self.events: list[tuple[str, list]] = []
        self.inserted: list[dict] = []

    async def category(self, slug):
        return self.category_row if slug == self.category_row.slug else None

    async def existing_prompts(self, _category_id, limit=200):
        if self._fail:
            raise RuntimeError("database went away")
        return self._existing

    async def start_job(self, category_id, request, worker_id):
        self.started.append({"category_id": category_id, "request": request, "worker_id": worker_id})
        return "job-inline"

    async def add_events(self, job_id, events):
        self.events.append((job_id, events))

    async def finish_job(self, job_id, **kwargs):
        self.finished.append((job_id, kwargs))

    async def insert_question(self, **kwargs):
        self.inserted.append(kwargs)
        return f"q-{len(self.inserted)}"


def service(db: StubDB) -> GenerationService:
    settings = Settings(
        _env_file=None,
        llm_provider="fake",
        panel_size=20,
        panel_wave_size=20,
        min_judge_overall=3.0,
        auto_approve=False,
    )
    return GenerationService(settings, db, FakeProvider(), index=None)  # type: ignore[arg-type]


RUN = dict(category_slug="everyday", count=2, panel_size=20)


async def test_a_direct_run_opens_its_own_provenance_row_and_closes_it():
    """The CLI and the inline endpoint have no queue row. They used to leave no
    record at all of what they cost or what they produced."""
    db = StubDB()
    report = await service(db).run(**RUN)

    assert len(db.started) == 1
    assert db.started[0]["worker_id"] == "inline"
    assert db.started[0]["request"]["category"] == "everyday"
    assert db.started[0]["request"]["count"] == 2

    assert len(db.finished) == 1
    job_id, closing = db.finished[0]
    assert job_id == "job-inline"
    assert closing["status"] == "succeeded"
    assert closing["prompt_version"], "the prompt version is what makes a quality shift traceable"
    assert closing["tokens"]["calls"] > 0
    assert closing["models"], "which models ran must be recorded"

    assert [e[0] for e in db.events] == ["job-inline"] and db.events[0][1], "the node trace is stored"
    assert report.questions, "the fake provider should bank something for this to mean anything"
    assert len(db.inserted) == len(report.questions)
    assert all(q["generation_id"] == "job-inline" for q in db.inserted), "every question points at its run"


async def test_a_queued_job_is_not_given_a_second_row():
    """The worker owns a queued job's row. Opening another is how a batch would
    end up recorded — and run — twice."""
    db = StubDB()
    await service(db).run(job_id="queued-1", **RUN)

    assert db.started == []
    assert [f[0] for f in db.finished] == ["queued-1"]
    assert all(q["generation_id"] == "queued-1" for q in db.inserted)


async def test_a_failing_direct_run_is_marked_failed_and_still_raises():
    db = StubDB(fail_on_existing=True)
    with pytest.raises(RuntimeError, match="database went away"):
        await service(db).run(**RUN)

    assert len(db.started) == 1
    assert len(db.finished) == 1
    job_id, closing = db.finished[0]
    assert job_id == "job-inline"
    assert closing["status"] == "failed"
    assert "database went away" in closing["error"]


async def test_a_failing_queued_job_is_left_for_the_worker_to_settle():
    """The worker knows about retries; the service must not close its row."""
    db = StubDB(fail_on_existing=True)
    with pytest.raises(RuntimeError):
        await service(db).run(job_id="queued-1", **RUN)
    assert db.finished == []


async def test_an_unknown_category_creates_no_row():
    db = StubDB()
    with pytest.raises(ValueError, match="unknown category"):
        await service(db).run(category_slug="nope", count=1)
    assert db.started == [] and db.finished == []


async def test_questions_already_in_the_bank_are_not_inserted_twice():
    """The unique index is the last line of defence behind the novelty check; a
    lost race must be reported as a duplicate, not crash the run."""
    db = StubDB()

    async def always_conflicts(**kwargs):
        return None  # ON CONFLICT DO NOTHING returned no row

    db.insert_question = always_conflicts  # type: ignore[method-assign]
    report = await service(db).run(**RUN)

    assert report.questions == []
    assert report.duplicates > 0
    assert any("insert raced" in r["reason"] for r in report.rejections)
