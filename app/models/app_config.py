"""Key/value app configuration table.

Used to persist runtime-tunable settings (eg. model provider, API keys)
that the admin can edit through the web UI. Values stored here override
the environment-derived `Settings` defaults.
"""
from __future__ import annotations

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class AppConfig(Base, TimestampMixin):
    __tablename__ = "app_config"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_secret: Mapped[bool] = mapped_column(default=False, nullable=False)
