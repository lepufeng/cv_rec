"""Application exception hierarchy.

All app-level errors inherit from BaseAppException so the API layer can render
a uniform error response. HTTP status mapping lives in `app/api/errors.py`.
"""
from __future__ import annotations

from typing import Any


class BaseAppException(Exception):
    """Base for all expected, structured application errors."""

    code: str = "INTERNAL_ERROR"
    http_status: int = 500
    message: str = "Internal error"

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message or self.message)
        if message:
            self.message = message
        if code:
            self.code = code
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "details": self.details,
        }


class ValidationError(BaseAppException):
    code = "VALIDATION_ERROR"
    http_status = 400
    message = "Invalid request"


class AuthError(BaseAppException):
    code = "AUTH_FAILED"
    http_status = 401
    message = "Authentication failed"


class ForbiddenError(BaseAppException):
    code = "FORBIDDEN"
    http_status = 403
    message = "Access denied"


class NotFoundError(BaseAppException):
    code = "NOT_FOUND"
    http_status = 404
    message = "Resource not found"


class BusinessError(BaseAppException):
    code = "BUSINESS_ERROR"
    http_status = 422
    message = "Business rule violated"


class ModelError(BaseAppException):
    code = "MODEL_ERROR"
    http_status = 502
    message = "Model service error"


class ConfigError(BaseAppException):
    code = "CONFIG_ERROR"
    http_status = 500
    message = "Server misconfigured"
