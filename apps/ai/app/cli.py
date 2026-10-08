"""Command line for the generation pipeline.

    python -m app.cli generate --category food --count 3
    python -m app.cli review
    python -m app.cli reindex
    python -m app.cli categories

Runs the pipeline in-process, so it works with the fake provider and no key.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

from app.config import get_settings
from app.db import Database
from app.main import configure_logging
from app.providers import build_provider
from app.retrieval.index import QuestionIndex
from app.runtime import run as run_async
from app.service import GenerationService


async def _service() -> tuple[GenerationService, Database, QuestionIndex]:
    settings = get_settings()
    configure_logging(settings.log_level)

    db = Database(settings.psycopg_url)
    await db.start()

    index = QuestionIndex(settings.qdrant_url, settings.qdrant_collection)
    try:
        await index.ensure()
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] qdrant unavailable ({exc}); dedup falls back to lexical comparison", file=sys.stderr)

    provider = build_provider(settings)
    return GenerationService(settings, db, provider, index), db, index


async def cmd_generate(args: argparse.Namespace) -> int:
    service, db, index = await _service()
    try:
        report = await service.run(
            category_slug=args.category,
            count=args.count,
            subtopic=args.subtopic or "",
            panel_size=args.panel_size,
        )
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        await index.aclose()
        await db.aclose()

    print()
    print(f"  category          {report.category}")
    print(f"  provider          {report.provider}")
    print(f"  approved          {report.approved}")
    print(f"  queued for review {report.queued_for_review}")
    print(f"  rejected          {report.rejected} (of which {report.duplicates} duplicates)")
    tokens = report.tokens
    print(f"  cost              ${report.cost_usd:.4f} over {tokens.get('calls', 0)} calls")
    print(
        f"  tokens            {tokens.get('input', 0):,} in ({tokens.get('cache_read', 0):,} cached)  "
        f"{tokens.get('output', 0):,} out ({tokens.get('reasoning', 0):,} reasoning)"
    )
    if tokens.get("unpriced_calls"):
        print(
            f"  note              {tokens['unpriced_calls']} calls ran on a model with no known price; "
            "the cost above is a lower bound"
        )
    print(f"  wall time         {report.latency_ms} ms")

    for q in report.questions:
        print()
        print(f"  {q['prompt']}")
        print(f"    {q['status']}  |  {q['difficulty']}  |  "
              f"coverage {q['coverage']:.0%}  |  top answer {q['top_share']:.0%}")
        for i, a in enumerate(q["answers"], start=1):
            print(f"    {i}. {a['text']:<28} {a['points']:>3}  ({a['panel_count']} said it)")
        if q.get("judge"):
            j = q["judge"]
            print(f"    judge: overall {j['overall']}/5, safety {j['safety']}/5 — {j['reason']}")

    if report.rejections:
        print()
        print("  rejected:")
        for r in report.rejections:
            print(f"    - {r['prompt']}")
            print(f"      {r['reason']}")
    return 0


async def cmd_review(args: argparse.Namespace) -> int:
    settings = get_settings()
    configure_logging(settings.log_level)
    db = Database(settings.psycopg_url)
    await db.start()
    try:
        rows = await db.review_queue(args.limit)
    finally:
        await db.aclose()

    if not rows:
        print("Nothing waiting for review.")
        return 0
    for row in rows:
        print()
        print(f"  [{row['category']}] {row['prompt']}")
        print(f"    id {row['id']}  |  quality {row['quality_score']}  |  coverage {row['panel_coverage']}")
        for a in row.get("answers") or []:
            print(f"      {a['rank']}. {a['text']:<28} {a['points']:>3}")
    print()
    print(f"{len(rows)} waiting. Approve with: POST /v1/admin/review/<id> {{\"decision\":\"approve\"}}")
    return 0


async def cmd_reindex(_: argparse.Namespace) -> int:
    service, db, index = await _service()
    try:
        count = await service.reindex()
    finally:
        await index.aclose()
        await db.aclose()
    print(f"indexed {count} questions")
    return 0


async def cmd_categories(_: argparse.Namespace) -> int:
    settings = get_settings()
    db = Database(settings.psycopg_url)
    await db.start()
    try:
        cats = await db.categories()
    finally:
        await db.aclose()
    print(json.dumps([{"slug": c.slug, "name": c.name} for c in cats], indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli", description="On The Board generation pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate", help="write, survey and judge new questions")
    gen.add_argument("--category", required=True)
    gen.add_argument("--count", type=int, default=3)
    gen.add_argument("--subtopic", default="")
    gen.add_argument("--panel-size", type=int, default=None, dest="panel_size")
    gen.set_defaults(func=cmd_generate)

    rev = sub.add_parser("review", help="list questions waiting for a human")
    rev.add_argument("--limit", type=int, default=20)
    rev.set_defaults(func=cmd_review)

    sub.add_parser("reindex", help="rebuild the vector index from Postgres").set_defaults(func=cmd_reindex)
    sub.add_parser("categories", help="list categories").set_defaults(func=cmd_categories)

    args = parser.parse_args(argv)
    return run_async(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
