"""Resume repository."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.resume import Resume


class ResumeRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, resume: Resume) -> Resume:
        self.session.add(resume)
        await self.session.flush()
        return resume

    async def get(self, resume_id: str) -> Resume | None:
        return await self.session.get(Resume, resume_id)

    async def by_content_hash(self, user_id: str, content_hash: str) -> Resume | None:
        stmt = select(Resume).where(
            Resume.user_id == user_id,
            Resume.content_hash == content_hash,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def latest_for_user(self, user_id: str) -> Resume | None:
        stmt = (
            select(Resume)
            .where(Resume.user_id == user_id)
            .order_by(Resume.created_at.desc())
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_for_user(self, user_id: str) -> list[Resume]:
        stmt = (
            select(Resume)
            .where(Resume.user_id == user_id)
            .order_by(Resume.created_at.desc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def delete(self, resume: Resume) -> None:
        await self.session.delete(resume)
