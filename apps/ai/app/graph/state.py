"""State carried between graph nodes."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, TypedDict

from app.models import GeneratedQuestion, Subtopic
from app.providers.base import Usage


@dataclass
class TraceEvent:
    """One node transition. Written to generation_events so that every banked
    question can be explained after the fact (ARCHITECTURE §10)."""

    node: str
    status: str
    detail: dict[str, Any] = field(default_factory=dict)
    latency_ms: int = 0


class GraphState(TypedDict, total=False):
    # Inputs
    category_slug: str
    category_name: str
    category_tagline: str
    locale: str
    count: int
    requested_subtopic: str
    panel_size: int
    existing_prompts: list[str]

    # Working state
    subtopics: list[Subtopic]
    drafts: list[str]
    current: str
    current_subtopic: str
    revision_feedback: str
    revisions_used: int

    # Outputs
    results: list[GeneratedQuestion]
    events: list[TraceEvent]
    usage: Usage
    error: str
