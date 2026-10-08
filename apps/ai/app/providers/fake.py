"""A deterministic stand-in for a language model.

This is not a stub that returns a constant. It exists so the entire generation
graph — including clustering, board building, the quality gates, the revision
loop and routing — can be exercised offline, in CI, and reproducibly, which is
the only way those parts get tested at all (ARCHITECTURE §13).

To do that honestly it has to behave like the thing it replaces in the ways the
pipeline depends on:

* the simulated panel must produce a *Zipf-like* spread of answers, because a
  flat distribution would make every board look identical and the coverage gate
  meaningless;
* the same concept must arrive under several phrasings, because merging those
  is exactly what the clustering step is for;
* everything must be a pure function of the prompt, so a test that passes twice
  passed for the same reason.
"""

from __future__ import annotations

import hashlib
import random
import re

from pydantic import BaseModel

from app.models import (
    JudgeVerdict,
    PanelWave,
    QuestionDraft,
    QuestionDrafts,
    Subtopic,
    SubtopicPlan,
)
from app.providers.base import Provider, ProviderError, Usage

# Concepts a survey respondent might offer, each with the phrasings real people
# actually type. The clustering step has to fold the variants back together.
CONCEPTS: list[tuple[str, list[str]]] = [
    ("Keys", ["keys", "my keys", "car keys", "house keys", "the keys"]),
    ("Phone", ["phone", "my phone", "mobile", "cell phone", "smartphone"]),
    ("Wallet", ["wallet", "my wallet", "purse", "money"]),
    ("Shoes", ["shoes", "my shoes", "trainers", "sandals"]),
    ("Food", ["food", "snacks", "something to eat", "lunch"]),
    ("Water", ["water", "a drink", "bottle of water", "drinking water"]),
    ("Traffic", ["traffic", "the traffic", "a traffic jam", "jam"]),
    ("Sleep", ["sleep", "sleeping", "a nap", "going to bed"]),
    ("Music", ["music", "songs", "listening to music", "a playlist"]),
    ("Family", ["family", "my family", "relatives", "parents"]),
    ("Money", ["money", "cash", "salary", "savings"]),
    ("Television", ["tv", "television", "watching tv", "the telly"]),
    ("Rain", ["rain", "the rain", "bad weather", "raining"]),
    ("Laughing", ["laughing", "laughter", "a laugh", "giggling"]),
    ("Dancing", ["dancing", "a dance", "dance moves", "dancing badly"]),
    ("Football", ["football", "soccer", "a match", "the game"]),
    ("Cooking", ["cooking", "making food", "the kitchen", "cooking dinner"]),
    ("School", ["school", "class", "homework", "lessons"]),
    ("Work", ["work", "the office", "my job", "working"]),
    ("Chocolate", ["chocolate", "sweets", "a chocolate bar", "candy"]),
]

SUBTOPIC_BANK = [
    ("Everyday habits", "small routines everyone recognises"),
    ("Mild frustrations", "things that quietly annoy people"),
    ("Social moments", "what happens when people are together"),
    ("Guilty pleasures", "things people enjoy and will not admit"),
    ("Household life", "what goes on inside a home"),
    ("Out and about", "shops, transport, queues, the street"),
    ("Childhood", "what people remember doing young"),
    ("Celebrations", "parties, holidays and gatherings"),
]

# Complete sentences with a single slot. Combining independent verb and
# situation lists produced word salad ("Name a reason someone might lose the
# power goes out."), which made the fake's output useless as a demo.
QUESTION_TEMPLATES = [
    "Name something people forget when {situation}.",
    "Name something people complain about when {situation}.",
    "Name something people always lose when {situation}.",
    "Name a reason someone might be in a bad mood when {situation}.",
    "Name something people argue about when {situation}.",
    "Name something people pretend to enjoy when {situation}.",
]
SITUATIONS = [
    "they are in a hurry",
    "the power goes out",
    "visitors arrive unannounced",
    "they are cooking dinner",
    "the whole family is together",
    "they are on a long journey",
    "the internet stops working",
    "they are getting ready for work",
]


def _seed(*parts: str) -> int:
    digest = hashlib.sha256("||".join(parts).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def _question_in(user: str) -> str:
    """Pull the question out of a panel prompt so a whole panel shares a pool."""
    match = re.search(r"^QUESTION:\s*(.+)$", user, flags=re.MULTILINE)
    return match.group(1).strip() if match else user[:120]


def _pool(question: str, size: int = 8) -> list[tuple[str, list[str]]]:
    """A stable set of plausible answers for one question."""
    rng = random.Random(_seed("pool", question))
    return rng.sample(CONCEPTS, k=min(size, len(CONCEPTS)))


def _zipf_weights(n: int) -> list[float]:
    """1/rank, the shape real survey answers take: one clear winner, a long tail."""
    return [1.0 / (i + 1) for i in range(n)]


class FakeProvider(Provider):
    name = "fake"

    def __init__(self, *, fail_schema: str | None = None) -> None:
        # Lets a test force a provider failure for one schema and check that the
        # graph degrades rather than crashes.
        self._fail_schema = fail_schema
        self.calls: list[tuple[str, str]] = []

    async def structured(
        self,
        *,
        system: str,
        user: str,
        schema: type[BaseModel],
        tier: str = "strong",
        temperature: float = 1.0,
        max_tokens: int = 2048,
        cache_system: bool = True,
    ):
        name = schema.__name__
        self.calls.append((name, tier))
        if self._fail_schema == name:
            raise ProviderError(f"fake provider was told to fail for {name}")

        usage = Usage(
            input_tokens=len(system) // 4 + len(user) // 4,
            output_tokens=40,
            calls=1,
            by_model={f"fake-{tier}": 1},
        )

        if schema is SubtopicPlan:
            return self._subtopics(user), usage
        if schema is QuestionDrafts:
            return self._questions(user), usage
        if schema is PanelWave:
            return self._panel_wave(user), usage
        if schema is JudgeVerdict:
            return self._verdict(user), usage
        if name == "MergeResult":
            return self._merge(user, schema), usage
        raise ProviderError(f"fake provider has no behaviour for {name}")

    def _merge(self, user: str, schema: type[BaseModel]):
        """Group the listed answers back to the concept each variant came from.

        The real provider does this with judgement; here the mapping is known,
        which makes the fake a faithful double for the one thing the semantic
        pass exists to do: merging synonyms that share no letters.
        """
        variant_to_concept: dict[str, str] = {}
        for concept, variants in CONCEPTS:
            for v in variants:
                variant_to_concept[v.lower()] = concept

        groups: dict[str, list[str]] = {}
        for line in user.splitlines():
            line = line.strip()
            if not line.startswith("- "):
                continue
            answer = re.sub(r"\s*\(\d+\)\s*$", "", line[2:]).strip()
            if not answer:
                continue
            key = variant_to_concept.get(answer.lower(), answer)
            groups.setdefault(key, []).append(answer)

        return schema(groups=[{"canonical": k, "members": v} for k, v in groups.items()])

    # ------------------------------------------------------------------ nodes

    def _subtopics(self, user: str) -> SubtopicPlan:
        rng = random.Random(_seed("subtopics", user))
        picked = rng.sample(SUBTOPIC_BANK, k=min(6, len(SUBTOPIC_BANK)))
        return SubtopicPlan(subtopics=[Subtopic(name=n, angle=a) for n, a in picked])

    def _questions(self, user: str) -> QuestionDrafts:
        rng = random.Random(_seed("questions", user))
        wanted = 3
        match = re.search(r"Write (\d+)", user)
        if match:
            wanted = max(1, min(8, int(match.group(1))))

        seen: set[str] = set()
        drafts: list[QuestionDraft] = []
        while len(drafts) < wanted:
            template = rng.choice(QUESTION_TEMPLATES)
            prompt = template.format(situation=rng.choice(SITUATIONS))
            if prompt in seen:
                # Exhausted the template space: nudge it so we always terminate.
                prompt = prompt[:-1] + f" ({len(drafts) + 1})."
            seen.add(prompt)
            drafts.append(QuestionDraft(prompt=prompt, why="Everyone has an answer to this."))
        return QuestionDrafts(questions=drafts)

    def _panel_wave(self, user: str) -> PanelWave:
        """Answer for every numbered person in the prompt, in order.

        Each person is seeded by their own description, so the answers differ
        from one another while the whole panel stays reproducible, and the
        spread across people is Zipf-shaped like a real survey.
        """
        question = _question_in(user)
        pool = _pool(question)
        people = re.findall(r"^\d+\.\s+(.+)$", user, flags=re.MULTILINE)

        answers: list[str] = []
        for person in people:
            rng = random.Random(_seed("panel", question, person))
            _concept, variants = rng.choices(pool, weights=_zipf_weights(len(pool)), k=1)[0]
            answers.append(rng.choice(variants))
        return PanelWave(answers=answers)

    def _verdict(self, user: str) -> JudgeVerdict:
        rng = random.Random(_seed("judge", user))
        # Mostly good, occasionally not: the routing and revision paths need to
        # see both outcomes.
        base = rng.choices([5, 4, 3, 2], weights=[0.35, 0.4, 0.2, 0.05], k=1)[0]
        jitter = lambda: max(1, min(5, base + rng.choice([-1, 0, 0, 1])))  # noqa: E731
        return JudgeVerdict(
            fun=jitter(),
            clarity=jitter(),
            breadth=jitter(),
            fairness=jitter(),
            safety=rng.choices([5, 4, 3], weights=[0.9, 0.08, 0.02], k=1)[0],
            overall=base,
            reason="Deterministic verdict from the fake provider.",
        )
