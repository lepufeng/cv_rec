"""Structured logging setup using structlog.

Output is JSON in production, key-value in dev for readability.
Sensitive fields (phone, email, name, id_card) should be passed via the
`mask_pii` helper before logging.
"""
from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import re
import sys

import structlog

from app.core.config import get_settings


_PHONE_RE = re.compile(r"(?<!\d)(1[3-9])(\d{4})(\d{4})(?!\d)")
_EMAIL_RE = re.compile(r"([A-Za-z0-9._%+-])([A-Za-z0-9._%+-]*)(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})")
_ID_CARD_RE = re.compile(r"(?<!\d)(\d{4})(\d{10})(\d{4})(?!\d)")


def mask_pii(value: str) -> str:
    """Mask common PII patterns in a string. Best-effort, not a security boundary."""
    if not value:
        return value
    value = _PHONE_RE.sub(r"\1****\3", value)
    value = _EMAIL_RE.sub(r"\1***\3", value)
    value = _ID_CARD_RE.sub(r"\1**********\3", value)
    return value


def configure_logging() -> None:
    """Configure structlog and stdlib logging. Call once at app startup."""
    settings = get_settings()
    level = getattr(logging, settings.log_level.upper(), logging.INFO)

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    console_renderer = (
        structlog.processors.JSONRenderer()
        if settings.app_env == "prod"
        else structlog.dev.ConsoleRenderer(colors=True)
    )

    console_formatter = structlog.stdlib.ProcessorFormatter(
        processor=console_renderer,
        foreign_pre_chain=shared_processors,
    )

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.setLevel(level)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_handler.setFormatter(console_formatter)
    root_logger.addHandler(console_handler)

    if settings.log_to_file:
        log_path = Path(settings.log_file_path)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler(
            log_path,
            maxBytes=settings.log_file_max_mb * 1024 * 1024,
            backupCount=settings.log_file_backup_count,
            encoding="utf-8",
        )
        file_handler.setLevel(level)
        file_handler.setFormatter(structlog.stdlib.ProcessorFormatter(
            processor=structlog.processors.JSONRenderer(),
            foreign_pre_chain=shared_processors,
        ))
        root_logger.addHandler(file_handler)

    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None):
    return structlog.get_logger(name)
