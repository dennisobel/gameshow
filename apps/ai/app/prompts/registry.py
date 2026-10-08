"""Versioned prompt templates, loaded from files next to this module.

Prompts live outside the code so they can be reused, tested, reviewed by people
who do not read Go or Python, and diffed when a question's quality changes
(AI Engineering, ch. 5). The version string is written onto every generation row,
so a shift in output quality can be traced to the prompt that caused it.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

PROMPT_VERSION = "2026-10-08.2"

_DIR = Path(__file__).parent


@lru_cache
def load(name: str) -> str:
    path = _DIR / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"prompt {name!r} not found at {path}")
    return path.read_text(encoding="utf-8").strip()


def render(name: str, **values: object) -> str:
    """Substitute {placeholders}. Deliberately not a template engine: prompts
    should stay readable as prose."""
    text = load(name)
    for key, value in values.items():
        text = text.replace("{" + key + "}", str(value))
    return text
