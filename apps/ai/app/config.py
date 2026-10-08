"""Service configuration, read from the environment."""

from __future__ import annotations

from functools import lru_cache

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    log_level: str = "info"
    internal_token: str = "dev-internal-token"

    database_url: str = "postgres://ontheboard:ontheboard@localhost:15432/ontheboard"
    qdrant_url: str = "http://localhost:16333"
    qdrant_collection: str = "questions"

    # "auto" picks OpenAI when a key is present and the deterministic fake
    # otherwise, so the pipeline is runnable and testable with no key.
    llm_provider: str = "auto"

    # A SecretStr, so that printing or logging the settings can never reveal it.
    # OPEN_AI_SECRET_KEY is accepted as well, because that is what it is called
    # in some existing .env files.
    openai_api_key: SecretStr = Field(
        default=SecretStr(""),
        validation_alias=AliasChoices("openai_api_key", "open_ai_secret_key"),
    )

    # One model per *role*, not one per vendor tier. The split is deliberate:
    #
    #   strong  writes the questions. Wants high temperature, which every model
    #           supports at its default, so the strongest model fits here.
    #   judge   scores them. Must be a DIFFERENT model from the writer, because a
    #           model grades its own output generously (AI Engineering ch. 3,
    #           "self-bias"), and wants a LOW temperature so that scores are
    #           reproducible, which not every model allows (gpt-5.5 does not).
    #   fast    plays the survey panel: ~60 tiny calls per question, so call
    #           count dominates cost. Must not be a reasoning model, which would
    #           spend its whole budget thinking before writing a two-word answer.
    model_strong: str = "gpt-5.5"
    model_judge: str = "gpt-5.4"
    model_fast: str = "gpt-5.4-mini"

    # Optional, per role. Empty means "do not send". A model that rejects the
    # parameter is detected at call time and the parameter is dropped for it.
    reasoning_effort_strong: str = ""
    reasoning_effort_judge: str = ""
    reasoning_effort_fast: str = ""

    panel_size: int = 60
    # Respondents per model call. 1 reproduces one-call-per-person, which collapses
    # onto the modal answer (see PanelWave); ~20 keeps the spread realistic.
    panel_wave_size: int = 20
    panel_concurrency: int = 12
    board_size: int = 5
    candidates_per_batch: int = 3

    # Quality gates, measured from the simulated survey. See graph/board.py for
    # what each one rejects and why.
    min_coverage: float = 0.55
    max_top_share: float = 0.70
    min_clusters: int = 4
    min_judge_overall: float = 3.5
    min_judge_safety: float = 4.0

    # Crawl-walk-run: false sends everything to the human review queue.
    auto_approve: bool = False
    worker_enabled: bool = True
    worker_poll_seconds: float = 5.0

    # Optional integrations; both stay off when unset.
    langsmith_api_key: str = ""
    cohere_api_key: str = ""

    @property
    def has_openai_key(self) -> bool:
        return bool(self.openai_api_key.get_secret_value().strip())

    @property
    def use_fake_provider(self) -> bool:
        if self.llm_provider == "fake":
            return True
        if self.llm_provider == "openai":
            return False
        return not self.has_openai_key

    @property
    def models(self) -> dict[str, str]:
        return {"strong": self.model_strong, "judge": self.model_judge, "fast": self.model_fast}

    @property
    def reasoning_efforts(self) -> dict[str, str]:
        return {
            "strong": self.reasoning_effort_strong.strip(),
            "judge": self.reasoning_effort_judge.strip(),
            "fast": self.reasoning_effort_fast.strip(),
        }

    @property
    def psycopg_url(self) -> str:
        """psycopg wants postgresql://, and rejects asyncpg-style query args."""
        url = self.database_url
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://") :]
        return url.split("?")[0]


@lru_cache
def get_settings() -> Settings:
    return Settings()
