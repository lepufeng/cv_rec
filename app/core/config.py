"""Application configuration via pydantic-settings.

All values are sourced from environment variables or `.env` file.
No hardcoded secrets, paths, or model identifiers should appear elsewhere.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Centralized configuration. Use `get_settings()` to obtain a cached instance."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- Application ----
    app_env: Literal["dev", "prod", "test"] = "dev"
    log_level: str = "INFO"
    secret_key: str = "dev-secret-change-me"

    # ---- Logging ----
    log_to_file: bool = True
    log_file_path: str = "./data/logs/app.log"
    log_file_max_mb: int = 10
    log_file_backup_count: int = 5
    log_request_enabled: bool = True
    debug_capture_invalid_model_outputs: bool = True
    debug_invalid_model_output_dir: str = "./data/debug/model_outputs"
    debug_invalid_model_output_max_chars: int = 20000

    # ---- Database ----
    database_url: str = "sqlite+aiosqlite:///./data/app.db"

    # ---- Storage ----
    storage_backend: Literal["local"] = "local"
    storage_local_path: str = "./data/uploads"

    # ---- Model provider selection ----
    model_provider: Literal["glm", "qwen", "fake"] = Field(
        default="glm",
        description="Which model adapter to use as primary.",
    )
    model_thinking_mode: Literal["enabled", "disabled"] = "disabled"

    # GLM (Zhipu AI / z.ai)
    glm_api_key: str = ""
    glm_base_url: str = "https://open.bigmodel.cn/api/paas/v4"
    glm_ocr_model: str = "glm-ocr"
    glm_vision_model: str = "glm-4.6v-flash"
    glm_chat_model: str = "glm-4.6v-flash"
    glm_reasoning_model: str = ""

    # Qwen (Alibaba DashScope OpenAI-compatible)
    qwen_api_key: str = ""
    qwen_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    qwen_ocr_model: str = ""
    qwen_vision_model: str = "qwen-vl-plus"
    qwen_chat_model: str = "qwen-vl-plus"
    qwen_reasoning_model: str = ""

    # ---- File limits ----
    max_file_size_mb: int = 10
    allowed_formats: tuple[str, ...] = ("pdf", "docx", "png", "jpg", "jpeg")

    # ---- Cache ----
    fill_plan_cache_ttl_days: int = 7

    @property
    def max_file_size_bytes(self) -> int:
        return self.max_file_size_mb * 1024 * 1024


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the singleton settings instance."""
    return Settings()
