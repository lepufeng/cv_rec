"""Authentication routes for both user and admin portals."""
from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import DbSession, UserSvc
from app.core.security import issue_token
from app.schemas.api import (
    AdminBootstrapStatus,
    LoginRequest,
    LoginResponse,
    RegisterUserRequest,
    RegisterUserResponse,
)
from app.services.user_service import UserService


router = APIRouter(tags=["auth"])


# ---------------- user portal ----------------

@router.post(
    "/auth/user/register",
    response_model=RegisterUserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def user_register(payload: RegisterUserRequest, svc: UserSvc) -> RegisterUserResponse:
    user = await svc.register_user(payload.username, payload.password)
    return RegisterUserResponse(
        user_id=user.id,
        username=user.username,
        token=issue_token(user.id, role="user"),
        is_admin=False,
    )


@router.post("/auth/user/login", response_model=LoginResponse)
async def user_login(payload: LoginRequest, svc: UserSvc) -> LoginResponse:
    user = await svc.login(payload.username, payload.password, require_admin=False)
    return LoginResponse(
        user_id=user.id,
        username=user.username,
        token=issue_token(user.id, role="user"),
        is_admin=False,
    )


# ---------------- admin portal ----------------

@router.get("/auth/admin/bootstrap-status", response_model=AdminBootstrapStatus)
async def admin_bootstrap_status(session: DbSession) -> AdminBootstrapStatus:
    """Tell the frontend whether to show the 'create first admin' form."""
    has_admin = await UserService(session).has_any_admin()
    return AdminBootstrapStatus(needs_bootstrap=not has_admin)


@router.post(
    "/auth/admin/bootstrap",
    response_model=LoginResponse,
    status_code=status.HTTP_201_CREATED,
)
async def admin_bootstrap(payload: RegisterUserRequest, svc: UserSvc) -> LoginResponse:
    """Create the very first admin. Locked once any admin exists."""
    admin = await svc.bootstrap_admin(payload.username, payload.password)
    return LoginResponse(
        user_id=admin.id,
        username=admin.username,
        token=issue_token(admin.id, role="admin"),
        is_admin=True,
    )


@router.post("/auth/admin/login", response_model=LoginResponse)
async def admin_login(payload: LoginRequest, svc: UserSvc) -> LoginResponse:
    admin = await svc.login(payload.username, payload.password, require_admin=True)
    return LoginResponse(
        user_id=admin.id,
        username=admin.username,
        token=issue_token(admin.id, role="admin"),
        is_admin=True,
    )
