"""Configuration and provider selection, including that the key stays secret."""

from __future__ import annotations

import logging

import pytest

from app.config import Settings
from app.providers import FakeProvider, ProviderError, build_provider
from app.providers.openai_provider import OpenAIProvider

KEY = "sk-proj-THIS-IS-A-TEST-KEY-9f8e7d6c"


def make(**overrides) -> Settings:
    # _env_file=None: a developer's real .env must not leak into a unit test.
    return Settings(_env_file=None, **overrides)


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for name in ("OPENAI_API_KEY", "OPEN_AI_SECRET_KEY", "LLM_PROVIDER", "MODEL_STRONG", "MODEL_JUDGE", "MODEL_FAST"):
        monkeypatch.delenv(name, raising=False)


# ------------------------------------------------------ provider selection


def test_no_key_means_the_fake_provider():
    s = make(llm_provider="auto")
    assert s.use_fake_provider and not s.has_openai_key
    assert isinstance(build_provider(s), FakeProvider)


def test_a_key_means_openai():
    s = make(llm_provider="auto", openai_api_key=KEY)
    assert not s.use_fake_provider and s.has_openai_key
    assert isinstance(build_provider(s), OpenAIProvider)


def test_a_blank_key_is_not_a_key():
    assert make(openai_api_key="   ").use_fake_provider


def test_fake_can_be_forced_even_with_a_key():
    s = make(llm_provider="fake", openai_api_key=KEY)
    assert isinstance(build_provider(s), FakeProvider)


def test_asking_for_openai_without_a_key_fails_loudly():
    """Silently falling back to the fake would hand someone synthetic questions
    while they believe they are looking at real ones."""
    with pytest.raises(ProviderError, match="OPENAI_API_KEY"):
        build_provider(make(llm_provider="openai"))


# ------------------------------------------------------------ the key name


def test_the_standard_variable_name_is_read(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", KEY)
    assert make().has_openai_key


def test_the_alternative_name_in_existing_env_files_is_read_too(monkeypatch):
    monkeypatch.setenv("OPEN_AI_SECRET_KEY", KEY)
    s = make()
    assert s.has_openai_key
    assert s.openai_api_key.get_secret_value() == KEY


# ----------------------------------------------------------------- secrecy


def test_the_key_never_appears_when_settings_are_printed_or_logged(caplog):
    s = make(openai_api_key=KEY)
    for rendering in (repr(s), str(s), str(s.model_dump()), s.model_dump_json()):
        assert KEY not in rendering
        assert "9f8e7d6c" not in rendering

    with caplog.at_level(logging.DEBUG):
        logging.getLogger("t").info("settings: %s", s)
    assert "9f8e7d6c" not in caplog.text


def test_the_provider_does_not_log_the_key_on_startup(caplog):
    with caplog.at_level(logging.DEBUG):
        build_provider(make(openai_api_key=KEY))
    assert "9f8e7d6c" not in caplog.text
    assert "using OpenAI" in caplog.text


# ------------------------------------------------------------------- models


def test_default_roles_use_three_distinct_models():
    s = make()
    assert len({s.model_strong, s.model_judge, s.model_fast}) == 3
    assert s.model_judge != s.model_strong, "the judge must not be the writer"


def test_models_can_be_overridden_from_the_environment(monkeypatch):
    monkeypatch.setenv("MODEL_FAST", "gpt-4.1-mini")
    assert make().models["fast"] == "gpt-4.1-mini"


def test_a_judge_that_is_also_the_writer_is_called_out(caplog):
    s = make(openai_api_key=KEY, model_judge="gpt-5.5", model_strong="gpt-5.5")
    with caplog.at_level(logging.WARNING):
        build_provider(s)
    assert "grades its own output" in caplog.text


def test_reasoning_effort_is_empty_unless_asked_for():
    assert set(make().reasoning_efforts.values()) == {""}
    assert make(reasoning_effort_fast=" minimal ").reasoning_efforts["fast"] == "minimal"
