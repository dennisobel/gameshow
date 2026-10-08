"""Deterministic checks on a drafted question, before any money is spent on it.

A survey panel costs sixty model calls. Everything that can be rejected for free
is rejected here first — the cheap-check-on-everything half of Huyen's
cheap-and-expensive pairing (ch. 4).

Each rejection returns a reason in plain words, because that reason is fed back
to the writer for its one revision attempt.
"""

from __future__ import annotations

import re

from app.graph.text import normalize

MIN_LENGTH = 18
MAX_LENGTH = 110

# The shapes that tell a listener what kind of thing to say.
GOOD_OPENINGS = ("name something", "name a ", "name an ", "name the ", "name someone", "name somewhere")

# Trivia tells: a question with one correct answer is not a survey question.
TRIVIA_MARKERS = (
    "what is the", "what was the", "who is the", "who was the", "when did",
    "when was", "where is the", "how many", "how much", "which of",
    "what year", "capital of", "the largest", "the smallest", "the first",
)

YES_NO_OPENINGS = (
    "is ", "are ", "do ", "does ", "did ", "can ", "could ", "would ",
    "will ", "have ", "has ", "should ",
)

# Topics the show does not go near. Matched on word boundaries so "classic"
# never trips "class" and "grapes" never trips "rape".
BANNED = (
    "suicide", "self harm", "rape", "incest", "porn", "pornographic",
    "genitals", "abortion", "overdose", "heroin", "cocaine", "meth",
    "terrorist", "terrorism", "massacre", "genocide", "slur", "racist",
    "nazi", "paedophile", "pedophile", "molest", "anal", "orgasm",
)

_BANNED_RE = re.compile(r"\b(" + "|".join(BANNED) + r")\b")


def check_format(prompt: str) -> str | None:
    """Return a reason to reject, or None if the question may proceed."""
    text = " ".join(prompt.split())
    lowered = text.lower()

    if len(text) < MIN_LENGTH:
        return "Too short to be a real question."
    if len(text) > MAX_LENGTH:
        return f"Too long at {len(text)} characters — it must be readable aloud in about three seconds."
    if "\n" in prompt:
        return "A question must be a single line."

    if _BANNED_RE.search(lowered):
        return "Touches a topic the show does not cover."

    if not lowered.startswith(GOOD_OPENINGS):
        return 'Must open with a survey framing, for example "Name something that..." or "Name a reason...".'

    if not text.endswith("."):
        return "Must end with a full stop."
    if text.count(".") > 1 or ";" in text or '"' in text or "?" in text:
        return "One plain sentence only — no extra punctuation, clauses or quotes."

    if any(lowered.startswith(o) for o in YES_NO_OPENINGS):
        return "Reads as a yes/no question."
    if any(marker in lowered for marker in TRIVIA_MARKERS):
        return "Reads as trivia with a single correct answer, not a survey question."

    # "you" invites answers about the player's own private life; the show asks
    # about people in general.
    words = normalize(text).split()
    if "you" in words or "your" in words:
        return 'Ask about people in general, not about the player ("you"/"your").'

    if len(words) < 4:
        return "Too few words to set up an answer."

    return None
