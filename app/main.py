"""FastAPI application entrypoint."""
from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import install_error_handlers
from app.api.v1 import admin, auth, fill_plans, health, resumes, users
from app.core.config import get_settings
from app.core.db import init_db
from app.core.logging import configure_logging, get_logger


configure_logging()
log = get_logger("main")
request_log = get_logger("http")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    log.info("startup", env=settings.app_env, model_provider=settings.model_provider)
    await init_db()
    yield
    log.info("shutdown")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Resume Parsing Platform",
        version="0.1.0",
        description=(
            "AI-powered resume parser & smart form-fill backend. "
            "Stage A: parse resume to structured JSON. "
            "Stage B: generate fill plan for browser extension."
        ),
        lifespan=lifespan,
    )

    # CORS — open during MVP. Tighten for production.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_logging_middleware(request: Request, call_next):
        settings = get_settings()
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        request.state.request_id = request_id
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            latency_ms = int((time.perf_counter() - started) * 1000)
            if settings.log_request_enabled:
                request_log.exception(
                    "http_request_failed",
                    status_code=500,
                    latency_ms=latency_ms,
                )
            raise
        else:
            latency_ms = int((time.perf_counter() - started) * 1000)
            response.headers["X-Request-Id"] = request_id
            if settings.log_request_enabled:
                request_log.info(
                    "http_request",
                    status_code=response.status_code,
                    latency_ms=latency_ms,
                )
            return response
        finally:
            structlog.contextvars.clear_contextvars()

    install_error_handlers(app)

    app.include_router(health.router, prefix="/api/v1")
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(users.router, prefix="/api/v1")
    app.include_router(resumes.router, prefix="/api/v1")
    app.include_router(fill_plans.router, prefix="/api/v1")
    app.include_router(admin.router, prefix="/api/v1")

    return app


app = create_app()
