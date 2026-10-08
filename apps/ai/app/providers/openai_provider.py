"""OpenAI-backed provider.

Structured output goes through `chat.completions.parse`, which sends the pydantic
model as a strict JSON schema and validates what comes back against it, so a
malformed response is an error here rather than a surprise three nodes later
(AI Engineering ch. 2).

What this module is careful about, because each of these was observed against
the live API rather than assumed:

* Models differ in which optional parameters they accept. `gpt-5.5` rejects any
  temperature but the default; `gpt-4.1` rejects `reasoning_effort`. Rather than
  keep a list of model names that would go stale, a 400 that names the parameter
  makes the provider drop it for that model and remember.
* A reasoning model can spend its whole token budget thinking and return nothing.
  That is a truncation, not a failure: retry with a larger budget.
* A refusal is not retried. Asking the same question again costs money and gets
  the same answer.
* Prompt caching is automatic on OpenAI and only starts at 1,024 prompt tokens.
  Most of our prompts are shorter, so expect little of it; `cached_tokens` is
  recorded whenever it happens.
"""

from __future__ import annotations

import asyncio
import logging
import re

from openai import (
    APIConnectionError,
    APIStatusError,
    AsyncOpenAI,
    BadRequestError,
    ContentFilterFinishReasonError,
    LengthFinishReasonError,
)
from pydantic import BaseModel, ValidationError

from app.config import Settings
from app.providers.base import Provider, ProviderError, ProviderRefusal, Usage

log = logging.getLogger(__name__)

# USD per million tokens: (input, cached input, output).
# Source: OpenAI's published pricing page, standard processing tier, retrieved
# 2026-10-08. A model missing from this table is still usable; its calls are
# counted in `Usage.unpriced_calls` and the reported cost is a lower bound.
PRICING: dict[str, tuple[float, float, float]] = {
    "gpt-5.5": (5.00, 0.50, 30.00),
    "gpt-5.4": (2.50, 0.25, 15.00),
    "gpt-5.4-mini": (0.75, 0.075, 4.50),
    "gpt-5.4-nano": (0.20, 0.02, 1.25),
    "gpt-4.1": (2.00, 0.50, 8.00),
    "gpt-4.1-mini": (0.40, 0.10, 1.60),
}

MAX_ATTEMPTS = 3
MAX_COMPLETION_BUDGET = 8192

# Optional request parameters that some models reject.
_OPTIONAL_PARAMS = ("temperature", "reasoning_effort")

_KEY_PATTERN = re.compile(r"sk-[A-Za-z0-9_\-*]+")


def redact(text: object) -> str:
    """Error text may echo part of a credential; never let it reach a log."""
    return _KEY_PATTERN.sub("sk-***", str(text))


_SNAPSHOT_SUFFIX = re.compile(r"-\d{4}-\d{2}-\d{2}$")


def price_for(*names: str) -> tuple[float, float, float] | None:
    """Look a model up by name, treating a dated snapshot as its base model.

    Responses report the snapshot that served the call ("gpt-5.4-mini-2026-03-
    17"), which is the same model at the same price as "gpt-5.4-mini".

    Deliberately NOT a prefix match. "gpt-5.4-pro" starts with "gpt-5.4" but is a
    different model at a different price, and billing it at the cheaper rate
    would be a silent error. An unknown model is reported as unpriced instead.
    """
    for name in names:
        base = _SNAPSHOT_SUFFIX.sub("", name)
        if base in PRICING:
            return PRICING[base]
    return None


class OpenAIProvider(Provider):
    name = "openai"

    def __init__(self, settings: Settings, client: AsyncOpenAI | None = None) -> None:
        # Transport retries (408/409/429/5xx, dropped connections) are the SDK's
        # job, with exponential backoff and Retry-After honoured. This class only
        # retries what the SDK cannot know about.
        self._client = client or AsyncOpenAI(
            api_key=settings.openai_api_key.get_secret_value(),
            max_retries=4,
            timeout=90.0,
        )
        self._models = settings.models
        self._effort = settings.reasoning_efforts
        self._unsupported: set[tuple[str, str]] = set()

    def _model(self, tier: str) -> str:
        return self._models.get(tier, self._models["strong"])

    def _request_params(self, model: str, tier: str, temperature: float, budget: int) -> dict:
        params: dict = {"max_completion_tokens": budget}
        # 1.0 is every model's default, so there is nothing to send, and not
        # sending it avoids a pointless rejection on models that allow no other.
        if temperature != 1.0 and (model, "temperature") not in self._unsupported:
            params["temperature"] = temperature
        effort = self._effort.get(tier, "")
        if effort and (model, "reasoning_effort") not in self._unsupported:
            params["reasoning_effort"] = effort
        return params

    def _learn_unsupported(self, model: str, message: str) -> bool:
        """If a 400 names an optional parameter, stop sending it to this model."""
        for param in _OPTIONAL_PARAMS:
            if param in message and (model, param) not in self._unsupported:
                self._unsupported.add((model, param))
                log.info("%s does not accept %r; omitting it from now on", model, param)
                return True
        return False

    async def structured(
        self,
        *,
        system: str,
        user: str,
        schema: type[BaseModel],
        tier: str = "strong",
        temperature: float = 1.0,
        max_tokens: int = 2048,
        cache_system: bool = True,  # noqa: ARG002 - caching is automatic on OpenAI
    ):
        model = self._model(tier)
        budget = max_tokens
        messages = [
            # The stable instructions come first and the volatile content last:
            # prompt caching matches on the longest shared prefix.
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]

        last_error = "unknown"
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                completion = await self._client.chat.completions.parse(
                    model=model,
                    messages=messages,
                    response_format=schema,
                    **self._request_params(model, tier, temperature, budget),
                )
            except LengthFinishReasonError:
                # A reasoning model can burn the whole budget before it writes a
                # single token of the answer. Give it more room.
                if budget >= MAX_COMPLETION_BUDGET:
                    raise ProviderError(f"{model}: ran out of tokens at {budget}") from None
                budget = min(budget * 4, MAX_COMPLETION_BUDGET)
                last_error = "truncated"
                log.info("%s truncated; retrying with a budget of %d", model, budget)
                continue
            except ContentFilterFinishReasonError as exc:
                raise ProviderRefusal(f"{model}: blocked by the content filter") from exc
            except BadRequestError as exc:
                message = redact(exc)
                if self._learn_unsupported(model, message):
                    continue  # same request, minus the parameter it objected to
                raise ProviderError(f"{model}: request rejected: {message[:300]}") from exc
            except ValidationError as exc:
                # The model produced JSON that does not satisfy our schema.
                last_error = f"output failed validation: {redact(exc)[:200]}"
                log.warning("%s: %s (attempt %d)", model, last_error, attempt)
                await asyncio.sleep(0.4 * attempt)
                continue
            except (APIStatusError, APIConnectionError) as exc:
                # The SDK has already retried; what is left is not transient.
                raise ProviderError(f"{model}: {redact(exc)[:300]}") from exc

            choice = completion.choices[0] if completion.choices else None
            if choice is None:
                last_error = "no choices returned"
                continue
            if choice.message.refusal:
                raise ProviderRefusal(f"{model} declined: {redact(choice.message.refusal)[:200]}")
            if choice.message.parsed is None:
                last_error = f"no parsed output (finish_reason={choice.finish_reason})"
                continue
            return choice.message.parsed, self._usage(completion, model)

        raise ProviderError(f"{model}: gave up after {MAX_ATTEMPTS} attempts: {last_error}")

    def _usage(self, completion, model: str) -> Usage:
        u = completion.usage
        if u is None:
            return Usage(calls=1, by_model={model: 1}, unpriced_calls=1)

        prompt = u.prompt_tokens or 0
        out = u.completion_tokens or 0
        cached = getattr(getattr(u, "prompt_tokens_details", None), "cached_tokens", 0) or 0
        reasoning = getattr(getattr(u, "completion_tokens_details", None), "reasoning_tokens", 0) or 0

        price = price_for(model, getattr(completion, "model", "") or "")
        if price is None:
            cost, unpriced = 0.0, 1
        else:
            rate_in, rate_cached, rate_out = price
            # `prompt_tokens` already includes the cached ones, so bill the rest
            # at the full rate. Reasoning tokens are part of `completion_tokens`.
            cost = ((prompt - cached) * rate_in + cached * rate_cached + out * rate_out) / 1_000_000
            unpriced = 0

        return Usage(
            input_tokens=prompt,
            output_tokens=out,
            cache_read_tokens=cached,
            reasoning_tokens=reasoning,
            calls=1,
            cost_usd=cost,
            unpriced_calls=unpriced,
            by_model={model: 1},
        )

    async def aclose(self) -> None:
        await self._client.close()
