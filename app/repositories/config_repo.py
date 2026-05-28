"""AppConfig key/value repository."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_config import AppConfig


class AppConfigRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, key: str) -> AppConfig | None:
        return await self.session.get(AppConfig, key)

    async def get_value(self, key: str, default: str = "") -> str:
        row = await self.get(key)
        return row.value if row else default

    async def set(self, key: str, value: str, *, is_secret: bool = False) -> AppConfig:
        row = await self.get(key)
        if row is None:
            row = AppConfig(key=key, value=value, is_secret=is_secret)
            self.session.add(row)
        else:
            row.value = value
            row.is_secret = is_secret
        await self.session.flush()
        return row

    async def all(self) -> list[AppConfig]:
        result = await self.session.execute(select(AppConfig).order_by(AppConfig.key))
        return list(result.scalars().all())

    async def delete(self, key: str) -> bool:
        row = await self.get(key)
        if row is None:
            return False
        await self.session.delete(row)
        return True
