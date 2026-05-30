"""Runtime model configuration management.

Reads/writes the `AppConfig` table. Values stored here override the
process-level `Settings` defaults, so admins can change the active model
provider and API keys without redeploying.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.repositories.config_repo import AppConfigRepository


# Keys that constitute the model configuration.
KEY_MODEL_PROVIDER = "model_provider"
KEY_MODEL_THINKING_MODE = "model_thinking_mode"
KEY_MODEL_NETWORK_MODE = "model_network_mode"
KEY_MODEL_PROXY_URL = "model_proxy_url"
KEY_GLM_API_KEY = "glm_api_key"
KEY_GLM_BASE_URL = "glm_base_url"
KEY_GLM_OCR_MODEL = "glm_ocr_model"
KEY_GLM_VISION_MODEL = "glm_vision_model"
KEY_GLM_CHAT_MODEL = "glm_chat_model"
KEY_GLM_REASONING_MODEL = "glm_reasoning_model"
KEY_QWEN_API_KEY = "qwen_api_key"
KEY_QWEN_BASE_URL = "qwen_base_url"
KEY_QWEN_OCR_MODEL = "qwen_ocr_model"
KEY_QWEN_VISION_MODEL = "qwen_vision_model"
KEY_QWEN_CHAT_MODEL = "qwen_chat_model"
KEY_QWEN_REASONING_MODEL = "qwen_reasoning_model"

SECRET_KEYS: set[str] = {KEY_GLM_API_KEY, KEY_QWEN_API_KEY}


@dataclass(slots=True)
class ModelConfig:
    provider: str  # "glm" | "qwen" | "fake"
    model_thinking_mode: str
    model_network_mode: str
    model_proxy_url: str
    glm_api_key: str
    glm_base_url: str
    glm_ocr_model: str
    glm_vision_model: str
    glm_chat_model: str
    glm_reasoning_model: str
    qwen_api_key: str
    qwen_base_url: str
    qwen_ocr_model: str
    qwen_vision_model: str
    qwen_chat_model: str
    qwen_reasoning_model: str


class ConfigService:
    """Resolve and update model configuration."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = AppConfigRepository(session)

    async def get_model_config(self) -> ModelConfig:
        settings = get_settings()
        provider = await self.repo.get_value(KEY_MODEL_PROVIDER, settings.model_provider)
        glm_chat_model = await self.repo.get_value(KEY_GLM_CHAT_MODEL, settings.glm_chat_model)
        qwen_chat_model = await self.repo.get_value(KEY_QWEN_CHAT_MODEL, settings.qwen_chat_model)
        return ModelConfig(
            provider=provider,
            model_thinking_mode=await self.repo.get_value(
                KEY_MODEL_THINKING_MODE,
                settings.model_thinking_mode,
            ),
            model_network_mode=await self.repo.get_value(
                KEY_MODEL_NETWORK_MODE,
                settings.model_network_mode,
            ),
            model_proxy_url=await self.repo.get_value(KEY_MODEL_PROXY_URL, settings.model_proxy_url),
            glm_api_key=await self.repo.get_value(KEY_GLM_API_KEY, settings.glm_api_key),
            glm_base_url=await self.repo.get_value(KEY_GLM_BASE_URL, settings.glm_base_url),
            glm_ocr_model=await self.repo.get_value(KEY_GLM_OCR_MODEL, settings.glm_ocr_model),
            glm_vision_model=await self.repo.get_value(KEY_GLM_VISION_MODEL, settings.glm_vision_model),
            glm_chat_model=glm_chat_model,
            glm_reasoning_model=await self.repo.get_value(
                KEY_GLM_REASONING_MODEL,
                settings.glm_reasoning_model or glm_chat_model,
            ),
            qwen_api_key=await self.repo.get_value(KEY_QWEN_API_KEY, settings.qwen_api_key),
            qwen_base_url=await self.repo.get_value(KEY_QWEN_BASE_URL, settings.qwen_base_url),
            qwen_ocr_model=await self.repo.get_value(KEY_QWEN_OCR_MODEL, settings.qwen_ocr_model),
            qwen_vision_model=await self.repo.get_value(KEY_QWEN_VISION_MODEL, settings.qwen_vision_model),
            qwen_chat_model=qwen_chat_model,
            qwen_reasoning_model=await self.repo.get_value(
                KEY_QWEN_REASONING_MODEL,
                settings.qwen_reasoning_model or qwen_chat_model,
            ),
        )

    async def update(self, updates: dict[str, str]) -> ModelConfig:
        """Persist a partial update of config keys."""
        for key, value in updates.items():
            await self.repo.set(key, value, is_secret=key in SECRET_KEYS)
        return await self.get_model_config()
