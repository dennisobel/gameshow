"""Provider selection."""

from __future__ import annotations

import logging

from app.config import Settings
from app.providers.base import Provider, ProviderError, ProviderRefusal, Usage
from app.providers.fake import FakeProvider

log = logging.getLogger(__name__)

__all__ = ["Provider", "ProviderError", "ProviderRefusal", "Usage", "FakeProvider", "build_provider"]


def build_provider(settings: Settings) -> Provider:
    if settings.use_fake_provider:
        log.warning(
            "no OPENAI_API_KEY: using the deterministic fake provider. "
            "The pipeline will run end to end, but the questions it writes are synthetic."
        )
        return FakeProvider()

    if not settings.has_openai_key:
        # Asked for OpenAI explicitly but gave no key. Falling back to the fake
        # here would hand someone synthetic questions while they believe they
        # are looking at real ones.
        raise ProviderError("LLM_PROVIDER=openai requires OPENAI_API_KEY to be set")

    models = settings.models
    if models["judge"] == models["strong"]:
        log.warning(
            "the judge and the writer are both %s. A model grades its own output "
            "generously, so approval rates will be inflated; set MODEL_JUDGE to a "
            "different model.",
            models["judge"],
        )

    # Imported lazily so the service starts without the SDK when the fake is used.
    from app.providers.openai_provider import OpenAIProvider

    log.info("using OpenAI (writer=%s, judge=%s, panel=%s)", models["strong"], models["judge"], models["fast"])
    return OpenAIProvider(settings)
