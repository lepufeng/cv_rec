"""Model adapter factory.

Returns a single client object that satisfies both `ChatModel` and `VisionModel`
protocols. Selection is driven by `Settings.model_provider` for legacy
synchronous callers; admin-managed runtime configuration is supported via
`build_model_from_config()`.
"""
from __future__ import annotations

from functools import lru_cache

from app.adapters.models.base import ChatModel, ModelResponse, ModelTier, OCRModel, VisionModel
from app.adapters.models.openai_compat import OpenAICompatClient
from app.core.config import get_settings
from app.core.exceptions import ConfigError


__all__ = [
    "get_model",
    "build_model_from_config",
    "build_reasoning_model_from_config",
    "ChatModel",
    "VisionModel",
    "OCRModel",
    "ModelResponse",
    "ModelTier",
]


@lru_cache(maxsize=1)
def get_model() -> OpenAICompatClient:
    """Build a model client from the static `Settings` (env-only).

    Used by tests and as a bootstrap fallback. For runtime-tunable behaviour
    the API layer prefers `build_model_from_config()` with values resolved
    from the AppConfig table.
    """
    settings = get_settings()
    return _build(
        provider=settings.model_provider,
        glm_api_key=settings.glm_api_key,
        glm_base_url=settings.glm_base_url,
        glm_ocr_model=settings.glm_ocr_model,
        glm_chat_model=settings.glm_chat_model,
        glm_vision_model=settings.glm_vision_model,
        thinking_mode=settings.model_thinking_mode,
        network_mode=settings.model_network_mode,
        proxy_url=settings.model_proxy_url,
        qwen_api_key=settings.qwen_api_key,
        qwen_base_url=settings.qwen_base_url,
        qwen_ocr_model=settings.qwen_ocr_model,
        qwen_chat_model=settings.qwen_chat_model,
        qwen_vision_model=settings.qwen_vision_model,
    )


def build_model_from_config(cfg, *, thinking_mode: str | None = None) -> OpenAICompatClient:
    """Build a client from a `ConfigService.ModelConfig` instance."""
    return _build(
        provider=cfg.provider,
        glm_api_key=cfg.glm_api_key,
        glm_base_url=cfg.glm_base_url,
        glm_ocr_model=cfg.glm_ocr_model,
        glm_chat_model=cfg.glm_chat_model,
        glm_vision_model=cfg.glm_vision_model,
        thinking_mode=thinking_mode or cfg.model_thinking_mode,
        network_mode=cfg.model_network_mode,
        proxy_url=cfg.model_proxy_url,
        qwen_api_key=cfg.qwen_api_key,
        qwen_base_url=cfg.qwen_base_url,
        qwen_ocr_model=cfg.qwen_ocr_model,
        qwen_chat_model=cfg.qwen_chat_model,
        qwen_vision_model=cfg.qwen_vision_model,
    )


def build_reasoning_model_from_config(cfg, *, thinking_mode: str | None = None) -> OpenAICompatClient:
    """Build a chat client using the configured reasoning model id.

    The reasoning model is intended for facts/schema review and other heavier
    semantic judgement tasks. API key and base URL are shared with the active
    provider; when no dedicated reasoning model is configured it falls back to
    the provider's chat model.
    """
    return _build(
        provider=cfg.provider,
        glm_api_key=cfg.glm_api_key,
        glm_base_url=cfg.glm_base_url,
        glm_ocr_model=cfg.glm_ocr_model,
        glm_chat_model=cfg.glm_reasoning_model or cfg.glm_chat_model,
        glm_vision_model=cfg.glm_vision_model,
        thinking_mode=thinking_mode or cfg.model_thinking_mode,
        network_mode=cfg.model_network_mode,
        proxy_url=cfg.model_proxy_url,
        qwen_api_key=cfg.qwen_api_key,
        qwen_base_url=cfg.qwen_base_url,
        qwen_ocr_model=cfg.qwen_ocr_model,
        qwen_chat_model=cfg.qwen_reasoning_model or cfg.qwen_chat_model,
        qwen_vision_model=cfg.qwen_vision_model,
    )


def _build(
    *,
    provider: str,
    glm_api_key: str,
    glm_base_url: str,
    glm_ocr_model: str,
    glm_chat_model: str,
    glm_vision_model: str,
    thinking_mode: str,
    qwen_api_key: str,
    qwen_base_url: str,
    qwen_ocr_model: str,
    qwen_chat_model: str,
    qwen_vision_model: str,
    network_mode: str = "direct",
    proxy_url: str = "",
) -> OpenAICompatClient:
    if provider == "glm":
        return OpenAICompatClient(
            api_key=glm_api_key,
            base_url=glm_base_url,
            ocr_model=glm_ocr_model,
            chat_model=glm_chat_model,
            vision_model=glm_vision_model,
            thinking_mode=thinking_mode,
            network_mode=network_mode,
            proxy_url=proxy_url,
        )
    if provider == "qwen":
        return OpenAICompatClient(
            api_key=qwen_api_key,
            base_url=qwen_base_url,
            ocr_model=qwen_ocr_model,
            chat_model=qwen_chat_model,
            vision_model=qwen_vision_model,
            thinking_mode=thinking_mode,
            network_mode=network_mode,
            proxy_url=proxy_url,
        )
    if provider == "fake":
        from tests.fakes.fake_model import FakeModel
        return FakeModel()  # type: ignore[return-value]
    raise ConfigError(f"Unsupported model provider: {provider}")


def reset_model_cache() -> None:
    """Reset the cached model client (used after config edits)."""
    if hasattr(get_model, "cache_clear"):
        get_model.cache_clear()
