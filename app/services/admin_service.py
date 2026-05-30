"""Admin queries: user listing, aggregate stats, model connectivity test."""
from __future__ import annotations

import time
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.models import build_model_from_config, build_reasoning_model_from_config
from app.adapters.models.openai_compat import OpenAICompatClient
from app.models.cost_log import CostLog
from app.models.resume import Resume
from app.models.user import User
from app.schemas.admin import (
    AdminUserItem,
    AdminUserListResponse,
    ModelTestResponse,
    StatsResponse,
)
from app.services.config_service import ConfigService


class AdminService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ---------------- users ----------------
    async def list_users(self) -> AdminUserListResponse:
        # Aggregate resume count and cost per user
        resume_counts = dict(
            (
                await self.session.execute(
                    select(Resume.user_id, func.count(Resume.id)).group_by(Resume.user_id)
                )
            ).all()
        )
        cost_totals = dict(
            (
                await self.session.execute(
                    select(CostLog.user_id, func.coalesce(func.sum(CostLog.cost_cny), 0))
                    .group_by(CostLog.user_id)
                )
            ).all()
        )

        users = (await self.session.execute(select(User).order_by(User.created_at.desc()))).scalars().all()
        items = [
            AdminUserItem(
                user_id=u.id,
                username=u.username,
                is_admin=u.is_admin,
                plan_tier=u.plan_tier,
                created_at=u.created_at,
                resume_count=int(resume_counts.get(u.id, 0)),
                total_cost_cny=Decimal(str(cost_totals.get(u.id, 0) or 0)),
            )
            for u in users
        ]
        return AdminUserListResponse(users=items, total=len(items))

    # ---------------- stats ----------------
    async def stats(self) -> StatsResponse:
        total_users = (await self.session.execute(select(func.count(User.id)))).scalar() or 0
        total_resumes = (await self.session.execute(select(func.count(Resume.id)))).scalar() or 0

        total_calls = (await self.session.execute(select(func.count(CostLog.id)))).scalar() or 0
        agg = (await self.session.execute(
            select(
                func.coalesce(func.sum(CostLog.input_tokens), 0),
                func.coalesce(func.sum(CostLog.output_tokens), 0),
                func.coalesce(func.sum(CostLog.cost_cny), 0),
            )
        )).one()
        total_input_tokens = int(agg[0] or 0)
        total_output_tokens = int(agg[1] or 0)
        total_cost = Decimal(str(agg[2] or 0))

        by_stage_rows = (await self.session.execute(
            select(
                CostLog.stage,
                func.count(CostLog.id),
                func.coalesce(func.sum(CostLog.cost_cny), 0),
            ).group_by(CostLog.stage)
        )).all()
        by_stage = {
            stage: {"calls": int(calls), "cost_cny": str(Decimal(str(cost or 0)))}
            for stage, calls, cost in by_stage_rows
        }

        by_model_rows = (await self.session.execute(
            select(
                CostLog.model_id,
                func.count(CostLog.id),
                func.coalesce(func.sum(CostLog.cost_cny), 0),
            ).group_by(CostLog.model_id)
        )).all()
        by_model = {
            model_id: {"calls": int(calls), "cost_cny": str(Decimal(str(cost or 0)))}
            for model_id, calls, cost in by_model_rows
        }

        return StatsResponse(
            total_users=int(total_users),
            total_resumes=int(total_resumes),
            total_calls=int(total_calls),
            total_input_tokens=total_input_tokens,
            total_output_tokens=total_output_tokens,
            total_cost_cny=total_cost,
            by_stage=by_stage,
            by_model=by_model,
        )

    # ---------------- model connectivity test ----------------
    async def test_model(self) -> ModelTestResponse:
        cfg = await ConfigService(self.session).get_model_config()
        if cfg.provider == "fake":
            return ModelTestResponse(
                ok=True,
                provider="fake",
                model_network_mode=cfg.model_network_mode,  # type: ignore[arg-type]
                chat_model="fake-chat",
                reasoning_model="fake-reasoning",
                latency_ms=0,
                sample="(fake provider; no real call)",
            )
        try:
            client: OpenAICompatClient = build_model_from_config(cfg)
            reasoning_client: OpenAICompatClient = build_reasoning_model_from_config(cfg)
        except Exception as exc:
            return ModelTestResponse(
                ok=False,
                provider=cfg.provider,
                model_network_mode=cfg.model_network_mode,  # type: ignore[arg-type]
                chat_model="",
                reasoning_model="",
                error=f"build failed: {exc}",
            )

        start = time.perf_counter()
        try:
            response = await client.chat(
                system="You are a helpful assistant.",
                user="reply with the single word: pong",
                response_format="text",
                temperature=0.0,
            )
        except Exception as exc:
            return ModelTestResponse(
                ok=False,
                provider=cfg.provider,
                model_network_mode=cfg.model_network_mode,  # type: ignore[arg-type]
                chat_model=client.chat_model_id,
                reasoning_model=reasoning_client.chat_model_id,
                latency_ms=int((time.perf_counter() - start) * 1000),
                error=str(exc)[:300],
            )

        reasoning_model = response.model_id
        if reasoning_client.chat_model_id != client.chat_model_id:
            try:
                reasoning_response = await reasoning_client.chat(
                    system="You are a reasoning model connectivity tester.",
                    user="reply with the single word: pong",
                    response_format="text",
                    temperature=0.0,
                )
                reasoning_model = reasoning_response.model_id
            except Exception as exc:
                return ModelTestResponse(
                    ok=False,
                    provider=cfg.provider,
                    model_network_mode=cfg.model_network_mode,  # type: ignore[arg-type]
                    chat_model=response.model_id,
                    reasoning_model=reasoning_client.chat_model_id,
                    latency_ms=int((time.perf_counter() - start) * 1000),
                    error=f"reasoning model failed: {str(exc)[:260]}",
                )

        return ModelTestResponse(
            ok=True,
            provider=cfg.provider,
            model_network_mode=cfg.model_network_mode,  # type: ignore[arg-type]
            chat_model=response.model_id,
            reasoning_model=reasoning_model,
            latency_ms=response.latency_ms,
            sample=response.content[:200],
        )
