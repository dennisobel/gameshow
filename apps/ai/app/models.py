"""Schemas for everything that crosses the model boundary.

Every structured call validates against one of these. A response that does not
fit is a failure we can see and retry, not a surprise three nodes later
(AI Engineering, ch. 2: structured outputs).
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class Subtopic(BaseModel):
    """One angle on a category, used to spread a batch across it."""

    name: str = Field(description="Short label, 2-5 words")
    angle: str = Field(description="What kind of question this should produce")


class SubtopicPlan(BaseModel):
    subtopics: list[Subtopic] = Field(min_length=1, max_length=12)


class QuestionDraft(BaseModel):
    prompt: str = Field(description="The question, as the host would read it aloud")
    why: str = Field(default="", description="One line on why this works as a survey question")


class QuestionDrafts(BaseModel):
    questions: list[QuestionDraft] = Field(min_length=1, max_length=8)


class PanelWave(BaseModel):
    """The answers of one wave of the survey: several different people, in turn.

    Why a wave and not one call per respondent: measured against the live model,
    sixty independent calls collapse onto the modal answer however different the
    personas are ("Fish" 60 of 60 for "a food that leaves a smell in the kitchen").
    One call that imagines a whole group of different people spreads naturally,
    because the model can see it has already said "stage" eight times. See
    docs/ARCHITECTURE.md §4 for the numbers.

    Each answer is deliberately tiny: a survey respondent says a word or two.
    """

    answers: list[str] = Field(
        description="One short answer (1-4 words) per person, in the order the people were listed"
    )


class JudgeVerdict(BaseModel):
    """Discrete 1-5 per criterion with a written reason.

    Classification and small discrete scales beat free-form numbers for AI
    judges (ch. 3), and the reason makes a rejection auditable.
    """

    fun: int = Field(ge=1, le=5, description="Would a room enjoy hearing this asked?")
    clarity: int = Field(ge=1, le=5, description="Is it instantly understood?")
    breadth: int = Field(ge=1, le=5, description="Do many different answers exist?")
    fairness: int = Field(ge=1, le=5, description="Can anyone answer it, or is it specialist trivia?")
    safety: int = Field(ge=1, le=5, description="5 = fine for a family audience")
    overall: int = Field(ge=1, le=5)
    reason: str = Field(description="One or two sentences explaining the scores")

    @property
    def mean(self) -> float:
        return (self.fun + self.clarity + self.breadth + self.fairness) / 4.0


# ------------------------------------------------------------------ internal

class AnswerCluster(BaseModel):
    """A merged group of panel responses: one board answer and its phrasings."""

    text: str
    count: int
    variants: list[str] = Field(default_factory=list)

    @property
    def aliases(self) -> list[str]:
        """Phrasings to accept during play, excluding the canonical text."""
        canonical = self.text.strip().lower()
        seen: set[str] = set()
        out: list[str] = []
        for v in self.variants:
            key = v.strip().lower()
            if key and key != canonical and key not in seen:
                seen.add(key)
                out.append(v)
        return out


class Board(BaseModel):
    answers: list[AnswerCluster]
    panel_size: int
    coverage: float = Field(description="Share of the panel captured by the board")
    top_share: float = Field(description="Share held by the single most popular answer")


class GeneratedQuestion(BaseModel):
    """A finished candidate, with every piece of evidence behind it."""

    prompt: str
    difficulty: str = "medium"
    board: Board
    verdict: JudgeVerdict | None = None
    status: str = "review"
    reject_reason: str = ""
    subtopic: str = ""
    revised: bool = False
