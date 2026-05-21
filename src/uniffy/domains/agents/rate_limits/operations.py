"""Rate-limit override CRUD.

Reads and writes the ``agents_rate_limits`` table. Write paths require
org-admin on the organization and invalidate the module-level overrides
cache so changes take effect immediately.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.agents.rate_limit_config import AgentRateLimitConfig
from uniffy.core.valkey.rate_limit import (
    ALL_LIMIT_KINDS,
    DEFAULT_LIMITS,
    LimitConfig,
    invalidate_overrides_cache,
)
from uniffy.domains.organizations.operations import OrganizationOperations

# Bounds to prevent nonsensical or abusive overrides. A 1-second window
# with a one-million-request limit would effectively disable the check,
# so we clamp both axes.
MIN_LIMIT = 1
MAX_LIMIT = 10_000
MIN_WINDOW_SECONDS = 1
MAX_WINDOW_SECONDS = 3_600


@dataclass
class RateLimitRow:
    """Unified shape returned by ``list_effective_limits``.

    Not a SQLModel - this is a transport object that combines an
    override (if present) with a default, so the caller sees one row
    per bucket kind regardless of whether a DB row exists.
    """

    kind: str
    limit: int
    window_seconds: int
    is_override: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None


class RateLimitsOperations:
    """Operations for the ``agents_rate_limits`` table.

    Parameters
    ----------
    session : AsyncSession
        Database session.

    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._org_ops = OrganizationOperations(session)

    async def list_effective_limits(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[RateLimitRow]:
        """Return one row per bucket kind, merged with server defaults.

        Org-member read. Callers always see the complete picture of
        active limits regardless of whether every bucket has an override.
        """
        await self._org_ops.require_org_member(user_id, organization_id)

        rows = await self._load_overrides(organization_id)
        by_kind = {row.limit_kind: row for row in rows}

        merged: list[RateLimitRow] = []
        for kind in ALL_LIMIT_KINDS:
            override = by_kind.get(kind)
            if override is not None:
                merged.append(
                    RateLimitRow(
                        kind=kind,
                        limit=override.limit,
                        window_seconds=override.window_seconds,
                        is_override=True,
                        created_at=override.created_at,
                        updated_at=override.updated_at,
                    )
                )
            else:
                default = DEFAULT_LIMITS[kind]
                merged.append(
                    RateLimitRow(
                        kind=kind,
                        limit=default.limit,
                        window_seconds=default.window_seconds,
                        is_override=False,
                    )
                )
        return merged

    async def upsert(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        kind: str,
        limit: int,
        window_seconds: int,
    ) -> RateLimitRow:
        """Create or update a rate-limit override for the organization.

        Writes an audit entry and invalidates the overrides cache so
        subsequent requests pick up the new value immediately.
        """
        await self._org_ops.require_org_admin(user_id, organization_id)

        if kind not in ALL_LIMIT_KINDS:
            raise ValidationError("kind", f"Unknown limit_kind: {kind}")
        if not MIN_LIMIT <= limit <= MAX_LIMIT:
            raise ValidationError(
                "limit",
                f"limit must be between {MIN_LIMIT} and {MAX_LIMIT}",
            )
        if not MIN_WINDOW_SECONDS <= window_seconds <= MAX_WINDOW_SECONDS:
            raise ValidationError(
                "window_seconds",
                f"window_seconds must be between {MIN_WINDOW_SECONDS} and {MAX_WINDOW_SECONDS}",
            )

        result = await self._session.execute(
            select(AgentRateLimitConfig).where(
                AgentRateLimitConfig.organization_id == organization_id,
                AgentRateLimitConfig.limit_kind == kind,
            )
        )
        existing = result.scalar_one_or_none()

        now = datetime.now(UTC)
        if existing is None:
            row = AgentRateLimitConfig(
                organization_id=organization_id,
                limit_kind=kind,
                limit=limit,
                window_seconds=window_seconds,
            )
            self._session.add(row)
            action = Action.AGENT_RATE_LIMIT_CREATED
        else:
            existing.limit = limit
            existing.window_seconds = window_seconds
            existing.updated_at = now
            row = existing
            action = Action.AGENT_RATE_LIMIT_UPDATED

        await self._session.commit()
        await self._session.refresh(row)

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=action,
            resource_type="rate_limit",
            resource_id=row.id,
            details={
                "kind": kind,
                "limit": limit,
                "window_seconds": window_seconds,
            },
        )
        await self._session.commit()

        invalidate_overrides_cache(organization_id)

        return RateLimitRow(
            kind=kind,
            limit=row.limit,
            window_seconds=row.window_seconds,
            is_override=True,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    async def delete(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        kind: str,
    ) -> None:
        """Remove an override so the bucket reverts to the default."""
        await self._org_ops.require_org_admin(user_id, organization_id)

        if kind not in ALL_LIMIT_KINDS:
            raise ValidationError("kind", f"Unknown limit_kind: {kind}")

        result = await self._session.execute(
            select(AgentRateLimitConfig).where(
                AgentRateLimitConfig.organization_id == organization_id,
                AgentRateLimitConfig.limit_kind == kind,
            )
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise NotFoundError("rate_limit_override", f"{organization_id}:{kind}")

        row_id = row.id
        await self._session.delete(row)
        await self._session.commit()

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.AGENT_RATE_LIMIT_DELETED,
            resource_type="rate_limit",
            resource_id=row_id,
            details={"kind": kind},
        )
        await self._session.commit()

        invalidate_overrides_cache(organization_id)

    async def _load_overrides(
        self,
        organization_id: UUID,
    ) -> list[AgentRateLimitConfig]:
        """Load all override rows for an organization (no caching here)."""
        result = await self._session.execute(
            select(AgentRateLimitConfig).where(
                AgentRateLimitConfig.organization_id == organization_id,
            )
        )
        return list(result.scalars().all())


def effective_limit_config(row: RateLimitRow) -> LimitConfig:
    """Convert a ``RateLimitRow`` back to the low-level ``LimitConfig``."""
    return LimitConfig(limit=row.limit, window_seconds=row.window_seconds)
