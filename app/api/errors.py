"""Centralised exception → ErrorResponse rendering."""
from __future__ import annotations

import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.exceptions import BaseAppException
from app.core.logging import get_logger
from app.schemas.api import ErrorResponse


log = get_logger("api")


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(BaseAppException)
    async def app_exception_handler(request: Request, exc: BaseAppException):
        request_id = _request_id(request)
        log.info(
            "app_exception",
            code=exc.code,
            status=exc.http_status,
            path=request.url.path,
            request_id=request_id,
        )
        body = ErrorResponse(
            code=exc.code,
            message=exc.message,
            details=exc.details,
            request_id=request_id,
        )
        return JSONResponse(status_code=exc.http_status, content=body.model_dump())

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(request: Request, exc: RequestValidationError):
        request_id = _request_id(request)
        body = ErrorResponse(
            code="VALIDATION_ERROR",
            message="Invalid request",
            details={"errors": exc.errors()[:5]},
            request_id=request_id,
        )
        return JSONResponse(status_code=400, content=body.model_dump())

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        request_id = _request_id(request)
        log.exception("unhandled_exception", path=request.url.path, request_id=request_id)
        body = ErrorResponse(
            code="INTERNAL_ERROR",
            message="Internal server error",
            request_id=request_id,
        )
        return JSONResponse(status_code=500, content=body.model_dump())


def _request_id(request: Request) -> str:
    state_request_id = getattr(request.state, "request_id", None)
    if state_request_id:
        return state_request_id
    rid = request.headers.get("x-request-id")
    return rid or uuid.uuid4().hex
