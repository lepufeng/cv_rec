"""FastAPI application entrypoint."""
from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.errors import install_error_handlers
from app.api.v1 import admin, auth, fill_plans, health, resumes, users
from app.core.config import get_settings
from app.core.db import init_db
from app.core.logging import configure_logging, get_logger


configure_logging()
log = get_logger("main")
request_log = get_logger("http")
PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIST = PROJECT_ROOT / "web" / "dist"


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
    mount_frontend(app)

    return app


def mount_frontend(app: FastAPI) -> None:
    """Serve the Vite production build when it exists.

    Local developers can still run Vite separately. For one-click/demo mode,
    `web/dist` lets the FastAPI process serve both the API and the UI.
    """
    index_html = FRONTEND_DIST / "index.html"
    assets_dir = FRONTEND_DIST / "assets"
    if not index_html.exists():
        log.info("frontend_dist_missing", path=str(FRONTEND_DIST))
        return

    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="frontend-assets")

    @app.get("/", include_in_schema=False)
    async def frontend_index():
        return FileResponse(index_html)

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend_spa(path: str):
        reserved = ("api/", "docs", "redoc", "openapi.json")
        if path.startswith(reserved):
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(index_html)


app = create_app()
