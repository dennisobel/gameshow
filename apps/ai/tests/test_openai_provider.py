"""The OpenAI provider, against a stub client.

No network, no key, no spend. Each behaviour tested here was first observed
against the live API (see the module docstring in openai_provider.py), so these
tests pin down facts rather than assumptions.
"""

from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest
from openai import (
    APIConnectionError,
    BadRequestError,
    ContentFilterFinishReasonError,
    LengthFinishReasonError,
)
from pydantic import BaseModel, ValidationError

from app.config import Settings
from app.providers import openai_provider
from app.providers.base import ProviderError, ProviderRefusal
from app.providers.openai_provider import PRICING, OpenAIProvider, price_for, redact


# ------------------------------------------------------------------ stubs


class PanelAnswer(BaseModel):
    """A minimal one-field schema. These tests are about the provider, not about
    any particular prompt in the pipeline."""

    answer: str


class StubCompletions:
    def __init__(self, script):
        self.script = list(script)
        self.calls: list[dict] = []

    async def parse(self, **kwargs):
        self.calls.append(kwargs)
        step = self.script.pop(0)
        if isinstance(step, BaseException):
            raise step
        return step


class StubClient:
    def __init__(self, script):
        self.completions = StubCompletions(script)
        self.chat = SimpleNamespace(completions=self.completions)
        self.closed = False

    async def close(self):
        self.closed = True


def completion(
    parsed="__default__",
    *,
    model="gpt-5.4-mini-2026-03-17",
    prompt=100,
    out=10,
    cached=0,
    reasoning=0,
    refusal=None,
    finish="stop",
):
    if parsed == "__default__":
        parsed = PanelAnswer(answer="keys")
    return SimpleNamespace(
        model=model,
        choices=[SimpleNamespace(message=SimpleNamespace(parsed=parsed, refusal=refusal), finish_reason=finish)],
        usage=SimpleNamespace(
            prompt_tokens=prompt,
            completion_tokens=out,
            prompt_tokens_details=SimpleNamespace(cached_tokens=cached),
            completion_tokens_details=SimpleNamespace(reasoning_tokens=reasoning),
        ),
    )


def bad_request(message: str) -> BadRequestError:
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    return BadRequestError(message, response=httpx.Response(400, request=request), body=None)


def settings(**overrides) -> Settings:
    base = dict(
        _env_file=None,
        llm_provider="openai",
        openai_api_key="sk-test-not-a-real-key",
        model_strong="gpt-5.5",
        model_judge="gpt-5.4",
        model_fast="gpt-5.4-mini",
    )
    base.update(overrides)
    return Settings(**base)


def provider(script, **overrides):
    client = StubClient(script)
    return OpenAIProvider(settings(**overrides), client=client), client.completions


async def ask(p, **kw):
    kw.setdefault("system", "You are a respondent.")
    kw.setdefault("user", "Name something people forget.")
    kw.setdefault("schema", PanelAnswer)
    return await p.structured(**kw)


@pytest.fixture(autouse=True)
def no_real_sleeping(monkeypatch):
    async def instant(_seconds):
        return None

    monkeypatch.setattr(openai_provider, "asyncio", SimpleNamespace(sleep=instant))


# ------------------------------------------------------------ happy path


async def test_returns_parsed_output_and_prices_the_call():
    p, calls = provider([completion(prompt=1000, cached=400, out=50, reasoning=20)])
    parsed, usage = await ask(p, tier="fast")

    assert isinstance(parsed, PanelAnswer) and parsed.answer == "keys"
    assert usage.calls == 1
    assert usage.input_tokens == 1000, "input_tokens is the TOTAL prompt, cached included"
    assert usage.cache_read_tokens == 400
    assert usage.output_tokens == 50
    assert usage.reasoning_tokens == 20
    assert usage.unpriced_calls == 0
    # 600 uncached x $0.75 + 400 cached x $0.075 + 50 out x $4.50, per million.
    assert usage.cost_usd == pytest.approx((600 * 0.75 + 400 * 0.075 + 50 * 4.50) / 1_000_000)
    # Booked against the model we asked for, not the dated snapshot that answered.
    assert usage.by_model == {"gpt-5.4-mini": 1}
    assert len(calls.calls) == 1


async def test_request_shape():
    p, calls = provider([completion()])
    await ask(p, tier="fast", system="SYS", user="USR", max_tokens=64)

    sent = calls.calls[0]
    assert sent["model"] == "gpt-5.4-mini"
    assert sent["messages"] == [
        {"role": "system", "content": "SYS"},  # stable prefix first, for prompt caching
        {"role": "user", "content": "USR"},
    ]
    assert sent["response_format"] is PanelAnswer
    assert sent["max_completion_tokens"] == 64
    assert "max_tokens" not in sent, "newer models reject the old parameter name"
    assert "temperature" not in sent, "1.0 is the default, so there is nothing to send"
    assert "reasoning_effort" not in sent


@pytest.mark.parametrize(
    "tier,expected",
    [("strong", "gpt-5.5"), ("judge", "gpt-5.4"), ("fast", "gpt-5.4-mini"), ("unknown", "gpt-5.5")],
)
async def test_each_role_uses_its_own_model(tier, expected):
    p, calls = provider([completion()])
    await ask(p, tier=tier)
    assert calls.calls[0]["model"] == expected


async def test_sends_a_non_default_temperature():
    p, calls = provider([completion()])
    await ask(p, tier="judge", temperature=0.2)
    assert calls.calls[0]["temperature"] == 0.2


# ------------------------------------- parameters a model may not accept


async def test_drops_a_parameter_the_model_rejects_and_remembers_it():
    """gpt-5.5 accepts only the default temperature. Found by calling it, so it
    is learned by calling it, not kept in a list that would go stale."""
    reject = bad_request(
        "Unsupported value: 'temperature' does not support 0.2 with this model. "
        "Only the default (1) value is supported."
    )
    p, calls = provider([reject, completion(), completion()], model_judge="gpt-5.5")

    await ask(p, tier="judge", temperature=0.2)
    assert "temperature" in calls.calls[0]
    assert "temperature" not in calls.calls[1], "the retry must omit what was rejected"

    await ask(p, tier="judge", temperature=0.2)
    assert "temperature" not in calls.calls[2], "and it must stay omitted for that model"


async def test_what_one_model_rejects_is_still_sent_to_another():
    reject = bad_request("Unsupported value: 'temperature' does not support 0.2 with this model.")
    p, calls = provider([reject, completion(), completion()])

    await ask(p, tier="strong", temperature=0.2)  # gpt-5.5 rejects it
    await ask(p, tier="judge", temperature=0.2)  # gpt-5.4 does not
    assert "temperature" in calls.calls[2]


async def test_reasoning_effort_is_sent_only_when_configured_and_dropped_if_rejected():
    p, calls = provider(
        [completion(), bad_request("Unrecognized request argument supplied: reasoning_effort"), completion()],
        reasoning_effort_fast="minimal",
    )
    await ask(p, tier="fast")
    assert calls.calls[0]["reasoning_effort"] == "minimal"

    await ask(p, tier="fast")
    assert "reasoning_effort" in calls.calls[1]
    assert "reasoning_effort" not in calls.calls[2], "rejected, so the retry omits it"


async def test_an_unrelated_bad_request_is_not_retried():
    p, calls = provider([bad_request("Invalid schema for response_format 'X': something else entirely")])
    with pytest.raises(ProviderError, match="request rejected"):
        await ask(p)
    assert len(calls.calls) == 1, "retrying a request the API called invalid only burns time"


# -------------------------------------------------------------- truncation


async def test_truncation_retries_with_a_bigger_budget():
    """A reasoning model can spend its whole budget thinking and return nothing."""
    truncated = LengthFinishReasonError(completion=SimpleNamespace(usage=None))
    p, calls = provider([truncated, completion()])

    parsed, _ = await ask(p, max_tokens=64)
    assert parsed.answer == "keys"
    assert calls.calls[0]["max_completion_tokens"] == 64
    assert calls.calls[1]["max_completion_tokens"] == 256


async def test_truncation_gives_up_at_the_ceiling():
    truncated = lambda: LengthFinishReasonError(completion=SimpleNamespace(usage=None))  # noqa: E731
    p, calls = provider([truncated(), truncated(), truncated()])

    with pytest.raises(ProviderError, match="ran out of tokens"):
        await ask(p, max_tokens=4096)
    assert [c["max_completion_tokens"] for c in calls.calls] == [4096, 8192]


# ----------------------------------------------------------------- refusals


async def test_a_refusal_is_raised_and_never_retried():
    p, calls = provider([completion(parsed=None, refusal="I can't help with that.")])
    with pytest.raises(ProviderRefusal):
        await ask(p)
    assert len(calls.calls) == 1, "the same question gets the same answer"


async def test_the_content_filter_counts_as_a_refusal():
    p, calls = provider([ContentFilterFinishReasonError()])
    with pytest.raises(ProviderRefusal):
        await ask(p)
    assert len(calls.calls) == 1


# ------------------------------------------------------------ other failures


async def test_transport_errors_surface_without_a_second_layer_of_retries():
    """The SDK already retried with backoff; what reaches us is not transient."""
    error = APIConnectionError(request=httpx.Request("POST", "https://api.openai.com/v1/chat/completions"))
    p, calls = provider([error])
    with pytest.raises(ProviderError):
        await ask(p)
    assert len(calls.calls) == 1


async def test_output_that_fails_validation_is_retried_then_surfaces():
    try:
        PanelAnswer.model_validate({})
    except ValidationError as exc:
        invalid = exc
    p, calls = provider([invalid, invalid, invalid])

    with pytest.raises(ProviderError, match="gave up after 3 attempts"):
        await ask(p)
    assert len(calls.calls) == 3


async def test_a_transient_validation_failure_recovers():
    try:
        PanelAnswer.model_validate({})
    except ValidationError as exc:
        invalid = exc
    p, _ = provider([invalid, completion()])
    parsed, _ = await ask(p)
    assert parsed.answer == "keys"


async def test_an_empty_response_is_retried():
    p, calls = provider([SimpleNamespace(choices=[], usage=None, model="x"), completion()])
    parsed, _ = await ask(p)
    assert parsed.answer == "keys"
    assert len(calls.calls) == 2


async def test_close_closes_the_client():
    client = StubClient([])
    p = OpenAIProvider(settings(), client=client)
    await p.aclose()
    assert client.closed


# ------------------------------------------------------------------ pricing


async def test_an_unknown_model_is_counted_but_flagged_as_unpriced():
    p, _ = provider([completion(model="gpt-9-hypothetical", prompt=500, out=40)], model_fast="gpt-9-hypothetical")
    _, usage = await ask(p, tier="fast")

    assert usage.cost_usd == 0.0
    assert usage.unpriced_calls == 1, "otherwise the report would claim this call was free"
    assert usage.input_tokens == 500 and usage.output_tokens == 40


async def test_missing_usage_is_flagged_rather_than_crashing():
    bare = completion()
    bare.usage = None
    p, _ = provider([bare])
    _, usage = await ask(p)
    assert usage.calls == 1 and usage.unpriced_calls == 1


def test_a_dated_snapshot_prices_as_its_base_model():
    assert price_for("gpt-5.4-mini-2026-03-17") == PRICING["gpt-5.4-mini"]
    assert price_for("gpt-5.5") == PRICING["gpt-5.5"]
    assert price_for("nonsense", "gpt-4.1-mini-2025-04-14") == PRICING["gpt-4.1-mini"]


def test_a_different_model_sharing_a_prefix_is_not_priced_as_its_cousin():
    """gpt-5.4-pro starts with gpt-5.4 but is a different model at a different
    price. Guessing the cheaper one would be a silent error."""
    assert price_for("gpt-5.4-pro") is None
    assert price_for("gpt-5.4-mini-high") is None


def test_the_pricing_table_is_sane():
    for model, (rate_in, rate_cached, rate_out) in PRICING.items():
        assert rate_cached < rate_in < rate_out, f"{model}: cached < input < output should hold"


# ----------------------------------------------------------------- secrets


def test_redact_removes_anything_shaped_like_a_key():
    leaked = "Incorrect API key provided: sk-proj-abc123_DEF-456. You can find your API key..."
    cleaned = redact(leaked)
    assert "abc123" not in cleaned and "sk-***" in cleaned
    assert redact("masked: sk-proj-****abcd") == "masked: sk-***"


async def test_an_error_that_echoes_the_key_is_redacted_before_it_is_raised():
    p, _ = provider([bad_request("Incorrect API key provided: sk-proj-SECRETSECRET123.")])
    with pytest.raises(ProviderError) as info:
        await ask(p)
    assert "SECRETSECRET123" not in str(info.value)
