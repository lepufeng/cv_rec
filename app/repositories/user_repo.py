"""User repository."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, user: User) -> User:
        self.session.add(user)
        await self.session.flush()
        return user

    async def get(self, user_id: str) -> User | None:
        return await self.session.get(User, user_id)

    async def by_username(self, username: str) -> User | None:
        result = await self.session.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()

    async def admin_count(self) -> int:
        result = await self.session.execute(
            select(func.count(User.id)).where(User.is_admin.is_(True))
        )
        return int(result.scalar() or 0)
