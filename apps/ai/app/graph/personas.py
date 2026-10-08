"""The simulated survey panel.

A survey is only as good as the room it was taken in. If every simulated
respondent is the same person, the model returns the same answer sixty times and
the board is worthless. So each respondent gets a different persona, and the
panel is sampled deterministically from the question text — the same question
always convenes the same room, which makes a generation run reproducible.

This is Huyen's "AI can simulate humans" (ch. 8), with her warning about
coverage and diversity (ch. 8) taken seriously: the dimensions below are the
ones that actually change what a person says first.
"""

from __future__ import annotations

import hashlib
import random

AGES = [
    "in your late teens",
    "in your twenties",
    "in your thirties",
    "in your forties",
    "in your fifties",
    "in your sixties",
]

LIVES = [
    "living in a big city",
    "living in a small town",
    "living in a village",
    "who recently moved to a new country",
    "who has lived in the same place your whole life",
]

WORK = [
    "a teacher",
    "a nurse",
    "a driver",
    "a shopkeeper",
    "an office worker",
    "a student",
    "a builder",
    "a farmer",
    "a chef",
    "a hairdresser",
    "a mechanic",
    "retired",
    "looking after children at home",
    "working two jobs",
    "a security guard",
    "an accountant",
]

HOUSEHOLD = [
    "living alone",
    "living with family",
    "with young children",
    "with teenage children",
    "sharing a flat with friends",
    "living with your parents",
]

TEMPER = [
    "practical and to the point",
    "cheerful and chatty",
    "dry and a bit sarcastic",
    "thoughtful and slow to answer",
    "impatient, always in a hurry",
    "warm and sentimental",
]


def _seed(text: str) -> int:
    return int.from_bytes(hashlib.sha256(text.encode("utf-8")).digest()[:8], "big")


def build_panel(question: str, size: int) -> list[str]:
    """Convene a reproducible room of `size` distinct people for one question."""
    rng = random.Random(_seed(f"panel::{question}"))
    seen: set[tuple] = set()
    people: list[str] = []

    # Try for distinct combinations, but never spin forever on a small space.
    attempts = 0
    while len(people) < size and attempts < size * 20:
        attempts += 1
        combo = (
            rng.choice(AGES),
            rng.choice(LIVES),
            rng.choice(WORK),
            rng.choice(HOUSEHOLD),
            rng.choice(TEMPER),
        )
        if combo in seen:
            continue
        seen.add(combo)
        age, lives, work, household, temper = combo
        people.append(f"someone {age}, {lives}, {work}, {household}. You are {temper}")

    # Top up if the space ran dry (tiny panels on repeated runs).
    while len(people) < size:
        people.append(people[len(people) % max(1, len(people))])
    return people
