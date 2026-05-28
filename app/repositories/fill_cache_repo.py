"""FillPlan cache repository."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fill_plan_cache import FillPlanCache


class FillPlanCacheRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(
        self,
        *,
        user_id: str,
        resume_id: str,
        form_structure_hash: str,
    ) -> FillPlanCache | None:
        stmt = (
            select(FillPlanCache)
            .where(
                FillPlanCache.user_id == user_id,
                FillPlanCache.resume_id == resume_id,
                FillPlanCache.form_structure_hash == form_structure_hash,
            )
            .order_by(FillPlanCache.created_at.desc())
            .limit(1)
        )
        result = await self.session.execute(stmt)
        cache = result.scalar_one_or_none()
        if cache is None:
            return None
        # Normalize comparison: SQLite stores naive datetimes
        expires_at = cache.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            return None
        return cache

    async def add(self, cache: FillPlanCache) -> FillPlanCache:
        self.session.add(cache)
        await self.session.flush()
        return cache

    async def increment_hit(self, cache: FillPlanCache) -> None:
        cache.hit_count += 1
        await self.session.flush()

    async def delete_for_resume(self, *, user_id: str, resume_id: str) -> int:
        stmt = delete(FillPlanCache).where(
            FillPlanCache.user_id == user_id,
            FillPlanCache.resume_id == resume_id,
        )
        result = await self.session.execute(stmt)
        return result.rowcount or 0
