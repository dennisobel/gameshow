"""The single seam between the pipeline and a language model.

Everything that calls a model goes through `Provider`. There are two
implementations: the real OpenAI client, and a deterministic fake that makes
the whole graph runnable offline and reproducibly in tests (ARCHITECTURE §13).
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


@dataclass
class Usage:
    """Token and cost accounting, summed across a whole generation run.

    `input_tokens` is the *total* prompt size, cached tokens included — that is
    how OpenAI reports it — and `cache_read_tokens` says how many of those were
    served from the prompt cache. `reasoning_tokens` is a subset of
    `output_tokens`: hidden thinking, billed as output.
    """

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    reasoning_tokens: int = 0
    calls: int = 0
    cost_usd: float = 0.0
    # Calls on a model whose price we do not know. Their tokens are counted but
    # their cost is not, so a non-zero value means `cost_usd` is a lower bound.
    unpriced_calls: int = 0
    by_model: dict[str, int] = field(default_factory=dict)

    def add(self, other: Usage) -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cache_read_tokens += other.cache_read_tokens
        self.reasoning_tokens += other.reasoning_tokens
        self.calls += other.calls
        self.cost_usd += other.cost_usd
        self.unpriced_calls += other.unpriced_calls
        for model, n in other.by_model.items():
            self.by_model[model] = self.by_model.get(model, 0) + n


class ProviderError(RuntimeError):
    """A model call failed in a way the caller may want to retry."""


class ProviderRefusal(ProviderError):
    """The model declined to answer. Retrying the same prompt will not help, so
    callers and the provider itself must not."""


class Provider(abc.ABC):
    """Roles, not model names, so the pipeline never hardcodes a model id.

    "strong"  writes (and plans) — quality matters, volume is low.
    "judge"   scores — a different model from the writer, at low temperature.
    "fast"    plays the survey panel — call count is high and each response is
              a couple of words.
    """

    name: str = "base"

    @abc.abstractmethod
    async def structured(
        self,
        *,
        system: str,
        user: str,
        schema: type[T],
        tier: str = "strong",
        temperature: float = 1.0,
        max_tokens: int = 2048,
        cache_system: bool = True,
    ) -> tuple[T, Usage]:
        """Return a validated instance of `schema`."""

    async def aclose(self) -> None:  # pragma: no cover - nothing to close by default
        return None
