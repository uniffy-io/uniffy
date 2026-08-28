"""Per-org agent runtime settings, backed by the generic ``org_settings`` store.

Stored as one JSON blob under ``namespace='agents'``, ``key='runtime'``. A missing
row (or a broken read) falls through to module defaults so a config hiccup never
blocks a send. A small in-process cache keeps the hot pre-flight read cheap.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.config.settings.organization import OrgSettingsOperations
from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.provider_key import ProviderKey
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.domains.agents.providers.catalog.images import (
    QUALITY_ORDER,
    RESOLUTION_ORDER,
)
from uniffy.domains.agents.providers.catalog.loader import provider_for_model
from uniffy.domains.organizations.operations import OrganizationOperations

logger = logger.bind(component="agents.runtime.settings.operations")

AGENTS_NAMESPACE = "agents"
RUNTIME_KEY = "runtime"

DEFAULT_SEND_DEADLINE_SECONDS = 300
DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5
DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS = 60
DEFAULT_DISPLAY_CURRENCY = "USD"
# Empty = no ceiling. Both clamp the resolved image params for every agent in
# the org, whichever layer asked for the larger output.
DEFAULT_IMAGE_MAX_RESOLUTION = ""
DEFAULT_IMAGE_MAX_QUALITY = ""


@dataclass(frozen=True)
class ResolvedRuntimeSettings:
    """Effective runtime settings for an organization."""

    send_deadline_seconds: int
    failover_enabled: bool
    resume_enabled: bool
    circuit_breaker_failure_threshold: int
    circuit_breaker_recovery_seconds: int
    display_currency: str
    personal_memory_bridge_enabled: bool
    default_provider_key_id: UUID | None
    default_chat_model: str | None
    image_max_resolution: str | None
    image_max_quality: str | None


_CACHE_TTL_SECONDS = 30.0
_cache: dict[UUID, tuple[float, ResolvedRuntimeSettings]] = {}


def _defaults() -> ResolvedRuntimeSettings:
    return ResolvedRuntimeSettings(
        send_deadline_seconds=DEFAULT_SEND_DEADLINE_SECONDS,
        failover_enabled=True,
        resume_enabled=True,
        circuit_breaker_failure_threshold=DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
        circuit_breaker_recovery_seconds=DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS,
        display_currency=DEFAULT_DISPLAY_CURRENCY,
        personal_memory_bridge_enabled=True,
        default_provider_key_id=None,
        default_chat_model=None,
        image_max_resolution=None,
        image_max_quality=None,
    )


def _coerce_key_id(raw: object) -> UUID | None:
    if not raw:
        return None
    try:
        return UUID(str(raw))
    except ValueError, AttributeError:
        return None


def _coerce_positive_int(raw: object, default: int) -> int:
    # This runs on the send pre-flight path; a malformed persisted value must
    # degrade to the default, never raise.
    try:
        value = int(raw)  # type: ignore[arg-type]
    except TypeError, ValueError:
        return default
    return value if value > 0 else default


def _coerce_choice(raw: object, allowed: tuple[str, ...]) -> str | None:
    value = str(raw).strip() if raw else ""
    return value if value in allowed else None


def _from_blob(blob: dict) -> ResolvedRuntimeSettings:
    model = blob.get("default_chat_model")
    return ResolvedRuntimeSettings(
        send_deadline_seconds=_coerce_positive_int(
            blob.get("send_deadline_seconds"), DEFAULT_SEND_DEADLINE_SECONDS
        ),
        failover_enabled=bool(blob.get("failover_enabled", True)),
        resume_enabled=bool(blob.get("resume_enabled", True)),
        circuit_breaker_failure_threshold=_coerce_positive_int(
            blob.get("circuit_breaker_failure_threshold"),
            DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
        ),
        circuit_breaker_recovery_seconds=_coerce_positive_int(
            blob.get("circuit_breaker_recovery_seconds"),
            DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS,
        ),
        display_currency=str(blob.get("display_currency") or DEFAULT_DISPLAY_CURRENCY),
        personal_memory_bridge_enabled=bool(blob.get("personal_memory_bridge_enabled", True)),
        default_provider_key_id=_coerce_key_id(blob.get("default_provider_key_id")),
        default_chat_model=str(model).strip() or None if model else None,
        image_max_resolution=_coerce_choice(blob.get("image_max_resolution"), RESOLUTION_ORDER),
        image_max_quality=_coerce_choice(blob.get("image_max_quality"), QUALITY_ORDER),
    )


async def get_runtime_settings(
    session: AsyncSession,
    organization_id: UUID,
) -> ResolvedRuntimeSettings:
    """Resolve runtime settings for ``organization_id`` (cached)."""
    cached = _cache.get(organization_id)
    if cached is not None:
        ts, value = cached
        if time.monotonic() - ts < _CACHE_TTL_SECONDS:
            return value

    try:
        rows = await OrgSettingsOperations(session).get_namespace(organization_id, AGENTS_NAMESPACE)
        row = rows.get(RUNTIME_KEY)
    except Exception:
        logger.opt(exception=True).warning("Failed to load runtime settings; using defaults")
        return _defaults()

    if row is None or not isinstance(row.value, dict):
        resolved = _defaults()
    else:
        resolved = _from_blob(row.value)

    _cache[organization_id] = (time.monotonic(), resolved)
    return resolved


def invalidate_runtime_settings_cache(organization_id: UUID | None = None) -> None:
    """Drop one org's cached settings (or all when ``None``)."""
    if organization_id is None:
        _cache.clear()
    else:
        _cache.pop(organization_id, None)


class RuntimeSettingsOperations:
    """Org-admin read/write for the per-org agent runtime settings blob."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._settings = OrgSettingsOperations(session)
        self._org_ops = OrganizationOperations(session)

    async def get(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
    ) -> tuple[ResolvedRuntimeSettings, bool]:
        await self._org_ops.require_org_admin(user_id, organization_id)
        row = await self._read_row(organization_id)
        configured = row is not None and isinstance(row.value, dict)
        resolved = _from_blob(row.value) if configured else _defaults()
        return resolved, configured

    async def update(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        send_deadline_seconds: int,
        failover_enabled: bool,
        resume_enabled: bool,
        circuit_breaker_failure_threshold: int,
        circuit_breaker_recovery_seconds: int,
        personal_memory_bridge_enabled: bool,
        default_provider_key_id: str,
        default_chat_model: str,
        image_max_resolution: str,
        image_max_quality: str,
    ) -> tuple[ResolvedRuntimeSettings, bool]:
        await self._org_ops.require_org_admin(user_id, organization_id)

        key_id = await self._validate_default_key(
            organization_id, default_provider_key_id, default_chat_model
        )

        # Only this writer's managed keys go in the patch; the database-side
        # JSONB merge leaves other writers' keys (display_currency) untouched
        # even under concurrent saves.
        patch = {
            "send_deadline_seconds": (
                max(1, int(send_deadline_seconds))
                if send_deadline_seconds
                else DEFAULT_SEND_DEADLINE_SECONDS
            ),
            "failover_enabled": bool(failover_enabled),
            "resume_enabled": bool(resume_enabled),
            "circuit_breaker_failure_threshold": (
                max(1, int(circuit_breaker_failure_threshold))
                if circuit_breaker_failure_threshold
                else DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD
            ),
            "circuit_breaker_recovery_seconds": (
                max(1, int(circuit_breaker_recovery_seconds))
                if circuit_breaker_recovery_seconds
                else DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS
            ),
            "personal_memory_bridge_enabled": bool(personal_memory_bridge_enabled),
            "default_provider_key_id": str(key_id) if key_id else "",
            "default_chat_model": (default_chat_model or "").strip(),
            "image_max_resolution": _coerce_choice(image_max_resolution, RESOLUTION_ORDER)
            or DEFAULT_IMAGE_MAX_RESOLUTION,
            "image_max_quality": _coerce_choice(image_max_quality, QUALITY_ORDER)
            or DEFAULT_IMAGE_MAX_QUALITY,
        }

        await self._settings.merge_json(
            organization_id=organization_id,
            namespace=AGENTS_NAMESPACE,
            key=RUNTIME_KEY,
            patch=patch,
            updated_by_user_id=user_id,
        )
        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.AGENT_RUNTIME_SETTINGS_UPDATED,
            resource_type=AuditResourceType.AGENT_RUNTIME_SETTINGS,
            resource_id=organization_id,
            details={
                "default_provider_key_id": patch["default_provider_key_id"],
                "default_chat_model": patch["default_chat_model"],
                "personal_memory_bridge_enabled": patch["personal_memory_bridge_enabled"],
                "image_max_resolution": patch["image_max_resolution"],
                "image_max_quality": patch["image_max_quality"],
            },
        )
        await self._session.commit()
        invalidate_runtime_settings_cache(organization_id)

        row = await self._read_row(organization_id)
        blob = row.value if (row is not None and isinstance(row.value, dict)) else patch
        return _from_blob(blob), True

    async def _read_row(self, organization_id: UUID):
        rows = await self._settings.get_namespace(organization_id, AGENTS_NAMESPACE)
        return rows.get(RUNTIME_KEY)

    async def _validate_default_key(
        self, organization_id: UUID, raw: str, default_chat_model: str
    ) -> UUID | None:
        """The org default routes every name-only agent's spend, so it must be
        a working key whose provider serves the default model."""
        raw = (raw or "").strip()
        if not raw:
            return None
        try:
            key_id = UUID(raw)
        except ValueError as exc:
            raise ValidationError("default_provider_key_id", "Invalid provider key id") from exc
        result = await self._session.execute(
            select(ProviderKey).where(
                ProviderKey.id == key_id,
                ProviderKey.organization_id == organization_id,
            )
        )
        key = result.scalar_one_or_none()
        if key is None:
            raise ValidationError(
                "default_provider_key_id",
                "Provider key not found in this organization",
            )
        if not (key.is_enabled and key.is_valid):
            raise ValidationError(
                "default_provider_key_id",
                "The default provider key must be enabled and valid",
            )
        model = (default_chat_model or "").strip()
        if model:
            model_provider = provider_for_model(model)
            if model_provider is not None and model_provider != key.provider:
                raise ValidationError(
                    "default_chat_model",
                    f"Model '{model}' belongs to provider '{model_provider}', "
                    f"but the default key is a '{key.provider}' key",
                )
        return key_id
