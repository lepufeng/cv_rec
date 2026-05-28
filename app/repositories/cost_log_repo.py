"""Cost log repository."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cost_log import CostLog


class CostLogRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, log: CostLog) -> CostLog:
        self.session.add(log)
        await self.session.flush()
        return log
