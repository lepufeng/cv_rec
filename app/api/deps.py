"""FastAPI dependencies."""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters import models as _models
from app.adapters.storage import get_storage
from app.core.db import get_db
from app.core.exceptions import AuthError, ForbiddenError, NotFoundError
from app.core.security import verify_token
from app.models.user import User
from app.services.config_service import ConfigService
from app.services.fill_service import FillService
from app.services.parsing_service import ParsingService
from app.services.resume_service import ResumeService
from app.services.user_service import UserService


DbSession = Annotated[AsyncSession, Depends(get_db)]


async def _resolve_user(authorization: str | None, session: AsyncSession) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthError("Missing or malformed Authorization header", code="AUTH_MISSING_TOKEN")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise AuthError("Empty token", code="AUTH_EMPTY_TOKEN")
    payload = verify_token(token)
    user = await UserService(session).get_by_id(payload["uid"])
    if user is None:
        raise NotFoundError("User no longer exists", code="NOT_FOUND_USER")
    return user


async def get_current_user(
    session: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    user = await _resolve_user(authorization, session)
    if user.is_admin:
        raise ForbiddenError(
            "Admin accounts cannot use user-facing endpoints",
            code="FORBIDDEN_ADMIN_ON_USER_ENDPOINT",
        )
    return user


async def get_current_admin(
    session: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    user = await _resolve_user(authorization, session)
    if not user.is_admin:
        raise ForbiddenError("Admin privileges required", code="FORBIDDEN_ADMIN")
    return user


async def get_authenticated(
    session: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    """Either user or admin. Used by /users/me where we don't want to gate by role."""
    return await _resolve_user(authorization, session)


CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(get_current_admin)]
AnyAuthenticated = Annotated[User, Depends(get_authenticated)]


def get_user_service(session: DbSession) -> UserService:
    return UserService(session)


def get_config_service(session: DbSession) -> ConfigService:
    return ConfigService(session)


async def _build_model(session: AsyncSession):
    """Pick the model client based on (DB config) > (env Settings)."""
    test_override = _models.get_model
    if hasattr(test_override, "cache_clear"):
        cfg = await ConfigService(session).get_model_config()
        return _models.build_model_from_config(cfg)
    return test_override()


async def get_resume_service(session: DbSession) -> ResumeService:
    model = await _build_model(session)
    parsing = ParsingService(model)
    storage = get_storage()
    return ResumeService(session, storage, parsing)


async def get_fill_service(session: DbSession) -> FillService:
    model = await _build_model(session)
    return FillService(session, model)


UserSvc = Annotated[UserService, Depends(get_user_service)]
ResumeSvc = Annotated[ResumeService, Depends(get_resume_service)]
FillSvc = Annotated[FillService, Depends(get_fill_service)]
ConfigSvc = Annotated[ConfigService, Depends(get_config_service)]
