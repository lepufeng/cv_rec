"""User self-lookup. Available to both regular users and admins."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import AnyAuthenticated
from app.schemas.api import CurrentUserResponse


router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=CurrentUserResponse)
async def me(user: AnyAuthenticated) -> CurrentUserResponse:
    return CurrentUserResponse(
        user_id=user.id,
        username=user.username,
        is_admin=user.is_admin,
        plan_tier=user.plan_tier,
    )
