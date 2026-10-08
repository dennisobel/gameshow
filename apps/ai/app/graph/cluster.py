"""Turning sixty raw survey responses into a board.

Two passes, cheapest first:

1. **Lexical.** Group by canonical form, then merge phrasings that are the same
   words in different clothes ("keys" / "my keys" / "car keys"). Deterministic,
   free, and handles most of the volume.
2. **Semantic.** Ask a model to merge what is left — "cell", "mobile" and
   "phone" are the same answer but share no letters, and no amount of string
   distance will ever say so.

The second pass is one call per question, which is why it is worth doing
properly rather than approximating.
"""

from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from app.graph.text import near_duplicate, normalize, strip_leading_filler
from app.models import AnswerCluster
from app.providers.base import Provider, ProviderError, Usage

log = logging.getLogger(__name__)

MERGE_SYSTEM = """\
You are tidying the results of a street survey.

Below is every distinct answer people gave to one question, with how many people
gave it. Some are the same answer written differently: "cell", "my mobile" and
"phone" are one answer; "keys" and "car keys" are one answer.

Group the answers that mean the same thing. For each group, choose the clearest,
shortest label a game show would put on a board — normally the most common
phrasing, in singular form, capitalised like a title.

Rules:
- Every answer must appear in exactly one group.
- Only merge answers that genuinely mean the same thing. "Tea" and "coffee" are
  different answers, even though both are drinks. When in doubt, keep separate.
- Do not invent answers that nobody gave.
"""


class _MergeGroup(BaseModel):
    canonical: str = Field(description="Board label for this group")
    members: list[str] = Field(description="Every raw answer belonging to this group")


class MergeResult(BaseModel):
    groups: list[_MergeGroup]


def lexical_clusters(responses: list[str]) -> list[AnswerCluster]:
    """Pass one: merge what can be merged without judgement."""
    heads: list[dict] = []
    for raw in responses:
        text = raw.strip()
        if not text or not normalize(text):
            continue
        for head in heads:
            if near_duplicate(text, head["text"]):
                head["variants"].append(text)
                head["count"] += 1
                # Keep the shortest phrasing as the label: survey boards read
                # better with "Phone" than with "my phone from my pocket".
                if len(text) < len(head["text"]):
                    head["text"] = text
                break
        else:
            heads.append({"text": text, "count": 1, "variants": [text]})

    heads.sort(key=lambda h: (-h["count"], h["text"]))
    return [
        AnswerCluster(text=_title(h["text"]), count=h["count"], variants=h["variants"])
        for h in heads
    ]


async def semantic_merge(
    clusters: list[AnswerCluster],
    *,
    question: str,
    provider: Provider,
) -> tuple[list[AnswerCluster], Usage]:
    """Pass two: merge synonyms that pass one could not see.

    On any failure the lexical clusters are returned unchanged. A board that is
    slightly over-split is a real board; no board at all is a lost question.
    """
    usage = Usage()
    if len(clusters) < 2:
        return clusters, usage

    listing = "\n".join(f"- {c.text} ({c.count})" for c in clusters)
    try:
        result, call_usage = await provider.structured(
            system=MERGE_SYSTEM,
            user=f"QUESTION: {question}\n\nAnswers given:\n{listing}",
            schema=MergeResult,
            tier="fast",
            temperature=0.2,
            max_tokens=1500,
        )
        usage.add(call_usage)
    except (ProviderError, Exception) as exc:  # noqa: BLE001 - degrade, never fail
        log.warning("semantic merge failed, keeping lexical clusters: %s", exc)
        return clusters, usage

    by_text = {c.text.strip().lower(): c for c in clusters}
    merged: list[AnswerCluster] = []
    claimed: set[str] = set()

    for group in result.groups:
        members = [by_text[m.strip().lower()] for m in group.members if m.strip().lower() in by_text]
        members = [m for m in members if m.text.strip().lower() not in claimed]
        if not members:
            continue
        for m in members:
            claimed.add(m.text.strip().lower())
        variants: list[str] = []
        for m in members:
            variants.extend(m.variants)
        label = group.canonical.strip() or members[0].text
        merged.append(
            AnswerCluster(
                text=_title(label),
                count=sum(m.count for m in members),
                variants=variants,
            )
        )

    # Anything the model forgot keeps its own cluster: no response is dropped.
    for c in clusters:
        if c.text.strip().lower() not in claimed:
            merged.append(c)

    merged.sort(key=lambda c: (-c.count, c.text))
    return merged, usage


def _title(text: str) -> str:
    """Board casing: drop the leading filler a respondent typed, capitalise the
    first letter, and leave the rest as written so acronyms and names survive.

    A board reads "Mobile", not "My mobile".
    """
    text = strip_leading_filler(" ".join(text.split()))
    if not text:
        return text
    return text[0].upper() + text[1:]
