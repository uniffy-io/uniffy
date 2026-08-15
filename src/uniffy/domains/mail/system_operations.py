"""Cross-tenant mail operations for platform operators.

Every method requires ``is_system_admin=true``. Tenant SMTP passwords
stay encrypted in ``org_settings.value_encrypted`` and are never read
here - presence is surfaced via ``smtp_password_set`` only.
"""

from __future__ import annotations

import os
from datetime import datetime
from enum import StrEnum
from typing import Any, NamedTuple
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.mail.config import MAIL_FROM_ADDRESS_KEY, MAIL_NAMESPACE, MailConfig
from uniffy.core.mail.resolver import MailConfigResolver
from uniffy.core.mail.suppression import SuppressionRepository, _normalize
from uniffy.core.models.audit.event import AuditEvent, AuditResourceType
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.mail.suppression import EmailSuppression
from uniffy.core.models.settings.deployment_setting import DeploymentSetting
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.domains.deployment_settings.operations import DeploymentSettingsOperations
from uniffy.domains.org_settings.operations import OrgSettingsOperations
from uniffy.domains.users.operations import UserOperations

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


class MailDeliveryOutcome(StrEnum):
    SENT = "sent"
    FAILED = "failed"
    SUPPRESSED = "suppressed"


class SystemMailConfigSummary(NamedTuple):
    """Non-secret view of the effective system mail config."""

    configured: bool
    effective_source: str  # 'deployment' | 'env' | 'none'
    from_address: str
    from_name: str
    reply_to: str
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password_set: bool
    smtp_use_tls: bool
    rate_limit_per_min: int


class OrgMailConfigRow(NamedTuple):
    organization_id: UUID
    organization_name: str
    organization_slug: str
    effective_source: str  # 'org' | 'env'
    from_address: str
    smtp_host: str
    smtp_password_set: bool
    verified_at: datetime | None
    last_test_at: datetime | None
    last_test_status: str | None


class OrgMailConfigPage(NamedTuple):
    rows: list[OrgMailConfigRow]
    total_count: int
    page: int
    page_size: int


class SuppressionPage(NamedTuple):
    entries: list[EmailSuppression]
    total_count: int
    page: int
    page_size: int


class DeliveryRow(NamedTuple):
    id: UUID
    created_at: datetime
    action: str
    config_source: str  # 'org' | 'env' | ''
    organization_id: UUID | None
    organization_name: str | None
    recipient: str | None
    template: str | None
    provider_message_id: str | None
    error: str | None


class DeliveryPage(NamedTuple):
    entries: list[DeliveryRow]
    total_count: int
    page: int
    page_size: int


def _empty_summary() -> SystemMailConfigSummary:
    return SystemMailConfigSummary(
        configured=False,
        effective_source="none",
        from_address="",
        from_name="",
        reply_to="",
        smtp_host="",
        smtp_port=587,
        smtp_username="",
        smtp_password_set=False,
        smtp_use_tls=True,
        rate_limit_per_min=100,
    )


def _system_summary_from_env() -> SystemMailConfigSummary:
    config = MailConfig.from_env()
    if config is None:
        return _empty_summary()
    # Presence-only check via env var so the plaintext never enters scope.
    smtp_password_set = bool(os.getenv("SMTP_PASSWORD"))
    return SystemMailConfigSummary(
        configured=True,
        effective_source="env",
        from_address=config.from_address,
        from_name=config.from_name,
        reply_to=config.reply_to or "",
        smtp_host=config.smtp_host,
        smtp_port=config.smtp_port,
        smtp_username=config.smtp_username or "",
        smtp_password_set=smtp_password_set,
        smtp_use_tls=config.smtp_use_tls,
        rate_limit_per_min=config.rate_limit_per_min,
    )


def _summary_from_deployment_rows(
    rows: dict[str, DeploymentSetting],
) -> SystemMailConfigSummary | None:
    # Returns None when ``from_address`` / ``smtp_host`` are missing so the
    # caller can fall through to env.
    from_address = _row_str(rows.get(MAIL_FROM_ADDRESS_KEY))
    smtp_host = _row_str(rows.get("smtp_host"))
    if not from_address or not smtp_host:
        return None
    password_row = rows.get("smtp_password")
    smtp_password_set = (
        password_row is not None
        and password_row.is_secret
        and password_row.value_encrypted is not None
    )
    return SystemMailConfigSummary(
        configured=True,
        effective_source="deployment",
        from_address=from_address,
        from_name=_row_str(rows.get("from_name")) or "Uniffy",
        reply_to=_row_str(rows.get("reply_to")),
        smtp_host=smtp_host,
        smtp_port=int(_row_value(rows.get("smtp_port")) or 587),
        smtp_username=_row_str(rows.get("smtp_username")),
        smtp_password_set=smtp_password_set,
        smtp_use_tls=(
            bool(_row_value(rows.get("smtp_use_tls")))
            if rows.get("smtp_use_tls") is not None
            else True
        ),
        rate_limit_per_min=int(_row_value(rows.get("rate_limit_per_min")) or 100),
    )


def _clamp_page_size(page_size: int) -> int:
    if page_size <= 0:
        return DEFAULT_PAGE_SIZE
    return min(page_size, MAX_PAGE_SIZE)


def _safe_page(page: int) -> int:
    return page if page > 0 else 0


def _row_value(row: OrgSetting | DeploymentSetting | None) -> Any:
    if row is None or row.is_secret:
        return None
    return row.value


def _row_str(row: OrgSetting | DeploymentSetting | None) -> str:
    value = _row_value(row)
    return "" if value is None else str(value)


def _row_datetime(row: OrgSetting | DeploymentSetting | None) -> datetime | None:
    value = _row_value(row)
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


class SystemMailOperations:
    """Platform-operator mail operations. Gated on ``is_system_admin``."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._user_ops = UserOperations(session)
        self._settings = OrgSettingsOperations(session)
        self._deployment = DeploymentSettingsOperations(session)
        self._suppressions = SuppressionRepository(session)

    async def get_system_config(self, *, user_id: UUID) -> SystemMailConfigSummary:
        """Resolve deployment rows -> env -> empty."""
        await self._user_ops.require_system_admin(user_id)
        deployment_rows = await self._deployment.get_namespace(MAIL_NAMESPACE)
        if deployment_rows:
            summary = _summary_from_deployment_rows(deployment_rows)
            if summary is not None:
                return summary
        return _system_summary_from_env()

    async def update_system_config(
        self,
        *,
        user_id: UUID,
        from_address: str,
        from_name: str,
        reply_to: str,
        smtp_host: str,
        smtp_port: int,
        smtp_username: str,
        smtp_password: str,  # empty -> leave existing
        smtp_use_tls: bool,
        rate_limit_per_min: int,
    ) -> SystemMailConfigSummary:
        await self._user_ops.require_system_admin(user_id)

        from_address = from_address.strip()
        smtp_host = smtp_host.strip()
        if not from_address:
            raise ValidationError("from_address", "from_address is required")
        if not smtp_host:
            raise ValidationError("smtp_host", "smtp_host is required")

        existing = await self._deployment.get_namespace(MAIL_NAMESPACE)
        had_deployment_config = bool(existing)

        updates: dict[str, Any] = {
            MAIL_FROM_ADDRESS_KEY: from_address,
            "from_name": from_name.strip() or "Uniffy",
            "reply_to": reply_to.strip(),
            "smtp_host": smtp_host,
            "smtp_port": int(smtp_port) if smtp_port else 587,
            "smtp_username": smtp_username,
            "smtp_use_tls": bool(smtp_use_tls),
            "rate_limit_per_min": int(rate_limit_per_min) if rate_limit_per_min else 100,
        }

        changed_keys = [k for k, v in updates.items() if _row_value(existing.get(k)) != v]

        for key, value in updates.items():
            await self._deployment.set(
                namespace=MAIL_NAMESPACE,
                key=key,
                value=value,
                is_secret=False,
                updated_by_user_id=user_id,
            )

        password_changed = bool(smtp_password)
        if password_changed:
            await self._deployment.set(
                namespace=MAIL_NAMESPACE,
                key="smtp_password",
                value=smtp_password,
                is_secret=True,
                updated_by_user_id=user_id,
            )
            changed_keys.append("smtp_password")

        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=user_id,
            action=Action.MAIL_SYSTEM_CONFIG_UPDATED,
            resource_type=AuditResourceType.SYSTEM_MAIL_CONFIG,
            resource_id=None,
            details={
                MAIL_FROM_ADDRESS_KEY: updates[MAIL_FROM_ADDRESS_KEY],
                "smtp_host": updates["smtp_host"],
                "smtp_port": updates["smtp_port"],
                "smtp_username": updates["smtp_username"],
                "smtp_use_tls": updates["smtp_use_tls"],
                "rate_limit_per_min": updates["rate_limit_per_min"],
                "password_changed": password_changed,
                "changed_keys": changed_keys,
                "was_new": not had_deployment_config,
            },
        )

        await self._session.commit()
        await MailConfigResolver.invalidate_system()

        return await self.get_system_config(user_id=user_id)

    async def clear_system_config(
        self,
        *,
        user_id: UUID,
        reason: str,
    ) -> int:
        """Drop every deployment-tier mail row; falls back to env."""
        await self._user_ops.require_system_admin(user_id)
        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")

        deleted = await self._deployment.delete_namespace(MAIL_NAMESPACE)
        if deleted:
            await write_audit_event(
                self._session,
                organization_id=None,
                actor_user_id=user_id,
                action=Action.MAIL_SYSTEM_CONFIG_CLEARED,
                resource_type=AuditResourceType.SYSTEM_MAIL_CONFIG,
                resource_id=None,
                details={"deleted_keys": deleted, "reason": reason},
            )
        await self._session.commit()
        await MailConfigResolver.invalidate_system()
        return deleted

    async def list_org_configs(
        self,
        *,
        user_id: UUID,
        page: int,
        page_size: int,
        search: str = "",
        only_with_org_config: bool = False,
    ) -> OrgMailConfigPage:
        await self._user_ops.require_system_admin(user_id)
        page = _safe_page(page)
        page_size = _clamp_page_size(page_size)

        search_filter = None
        normalized_search = search.strip().lower() if search else ""
        if normalized_search:
            pattern = f"%{normalized_search}%"
            search_filter = or_(
                func.lower(Organization.name).like(pattern),
                func.lower(Organization.slug).like(pattern),
            )

        if only_with_org_config:
            base = (
                select(Organization.id)
                .where(Organization.is_active == True)  # noqa: E712
                .where(
                    Organization.id.in_(
                        select(OrgSetting.organization_id)
                        .where(OrgSetting.namespace == MAIL_NAMESPACE)
                        .where(OrgSetting.key == MAIL_FROM_ADDRESS_KEY)
                        .where(OrgSetting.is_secret == False)  # noqa: E712
                    )
                )
            )
        else:
            base = select(Organization.id).where(Organization.is_active == True)  # noqa: E712

        if search_filter is not None:
            base = base.where(search_filter)

        total = (
            await self._session.execute(select(func.count()).select_from(base.subquery()))
        ).scalar_one()

        page_query = (
            select(Organization)
            .where(Organization.id.in_(base))
            .order_by(Organization.name.asc())
            .limit(page_size)
            .offset(page * page_size)
        )
        orgs = (await self._session.execute(page_query)).scalars().all()

        if not orgs:
            return OrgMailConfigPage(
                rows=[],
                total_count=int(total),
                page=page,
                page_size=page_size,
            )

        org_ids = [org.id for org in orgs]
        settings_rows = (
            (
                await self._session.execute(
                    select(OrgSetting).where(
                        OrgSetting.organization_id.in_(org_ids),
                        OrgSetting.namespace == MAIL_NAMESPACE,
                    )
                )
            )
            .scalars()
            .all()
        )

        per_org: dict[UUID, dict[str, OrgSetting]] = {oid: {} for oid in org_ids}
        for row in settings_rows:
            per_org[row.organization_id][row.key] = row

        out: list[OrgMailConfigRow] = []
        for org in orgs:
            rows = per_org[org.id]
            password_row = rows.get("smtp_password")
            smtp_password_set = (
                password_row is not None
                and password_row.is_secret
                and password_row.value_encrypted is not None
            )
            has_org_config = bool(rows)
            out.append(
                OrgMailConfigRow(
                    organization_id=org.id,
                    organization_name=org.name,
                    organization_slug=org.slug,
                    effective_source="org" if has_org_config else "env",
                    from_address=_row_str(rows.get(MAIL_FROM_ADDRESS_KEY)),
                    smtp_host=_row_str(rows.get("smtp_host")),
                    smtp_password_set=smtp_password_set,
                    verified_at=_row_datetime(rows.get("verified_at")),
                    last_test_at=_row_datetime(rows.get("last_test_at")),
                    last_test_status=(_row_str(rows.get("last_test_status")) or None),
                )
            )

        return OrgMailConfigPage(
            rows=out,
            total_count=int(total),
            page=page,
            page_size=page_size,
        )

    async def force_clear_org_config(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        reason: str,
    ) -> int:
        """Drop every ``mail.*`` row for one org; reason recorded in audit."""
        await self._user_ops.require_system_admin(user_id)
        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")

        org = (
            await self._session.execute(
                select(Organization).where(Organization.id == organization_id)
            )
        ).scalar_one_or_none()
        if org is None:
            raise NotFoundError("Organization", str(organization_id))

        deleted = await self._settings.delete_namespace(
            organization_id=organization_id,
            namespace=MAIL_NAMESPACE,
        )

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.MAIL_CONFIG_FORCE_CLEARED,
            resource_type=AuditResourceType.MAIL_CONFIG,
            resource_id=organization_id,
            details={
                "deleted_keys": deleted,
                "reason": reason,
            },
        )
        await self._session.commit()
        await MailConfigResolver.invalidate(organization_id)
        return deleted

    async def list_suppressions(
        self,
        *,
        user_id: UUID,
        page: int,
        page_size: int,
        search: str = "",
    ) -> SuppressionPage:
        await self._user_ops.require_system_admin(user_id)
        page = _safe_page(page)
        page_size = _clamp_page_size(page_size)

        base = select(EmailSuppression)
        count_base = select(func.count()).select_from(EmailSuppression)

        normalized_search = search.strip().lower() if search else ""
        if normalized_search:
            pattern = f"%{normalized_search}%"
            base = base.where(EmailSuppression.email.like(pattern))
            count_base = count_base.where(EmailSuppression.email.like(pattern))

        total = (await self._session.execute(count_base)).scalar_one()
        rows = (
            (
                await self._session.execute(
                    base
                    .order_by(EmailSuppression.created_at.desc())
                    .limit(page_size)
                    .offset(page * page_size)
                )
            )
            .scalars()
            .all()
        )

        return SuppressionPage(
            entries=list(rows),
            total_count=int(total),
            page=page,
            page_size=page_size,
        )

    async def remove_suppression(
        self,
        *,
        user_id: UUID,
        email: str,
        reason: str,
    ) -> bool:
        await self._user_ops.require_system_admin(user_id)
        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")
        normalized = _normalize(email)
        if not normalized or "@" not in normalized:  # noqa: PLR2004
            raise ValidationError("email", "email is not valid")

        removed = await self._suppressions.remove(normalized)
        if not removed:
            return False

        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=user_id,
            action=Action.MAIL_SUPPRESSION_REMOVED,
            resource_type=AuditResourceType.MAIL_SUPPRESSION,
            resource_id=None,
            details={"email": normalized, "reason": reason},
        )
        await self._session.commit()
        return True

    async def list_deliveries(
        self,
        *,
        user_id: UUID,
        page: int,
        page_size: int,
        organization_id: UUID | None = None,
        outcome: str = "",
    ) -> DeliveryPage:
        """Cross-tenant page of mail-send audit events."""
        await self._user_ops.require_system_admin(user_id)
        page = _safe_page(page)
        page_size = _clamp_page_size(page_size)

        action_filter = _outcome_actions(outcome)

        conditions = [AuditEvent.action.in_(action_filter)]
        if organization_id is not None:
            conditions.append(AuditEvent.organization_id == organization_id)

        where_clause = and_(*conditions)

        total = (
            await self._session.execute(
                select(func.count()).select_from(AuditEvent).where(where_clause)
            )
        ).scalar_one()

        events = (
            (
                await self._session.execute(
                    select(AuditEvent)
                    .where(where_clause)
                    .order_by(AuditEvent.created_at.desc())
                    .limit(page_size)
                    .offset(page * page_size)
                )
            )
            .scalars()
            .all()
        )

        if not events:
            return DeliveryPage(
                entries=[],
                total_count=int(total),
                page=page,
                page_size=page_size,
            )

        org_ids = {e.organization_id for e in events if e.organization_id is not None}
        org_names: dict[UUID, str] = {}
        if org_ids:
            orgs = (
                await self._session.execute(
                    select(Organization.id, Organization.name).where(Organization.id.in_(org_ids))
                )
            ).all()
            org_names = {oid: name for oid, name in orgs}

        rows = [_flatten_delivery(event, org_names.get(event.organization_id)) for event in events]

        return DeliveryPage(
            entries=rows,
            total_count=int(total),
            page=page,
            page_size=page_size,
        )


def _outcome_actions(outcome: str) -> list[str]:
    normalized = outcome.strip().lower()
    if normalized == MailDeliveryOutcome.SENT:
        return [Action.MAIL_SENT]
    if normalized == MailDeliveryOutcome.FAILED:
        return [Action.MAIL_SEND_FAILED]
    if normalized == MailDeliveryOutcome.SUPPRESSED:
        return [Action.MAIL_SUPPRESSED]
    return [Action.MAIL_SENT, Action.MAIL_SEND_FAILED, Action.MAIL_SUPPRESSED]


def _flatten_delivery(event: AuditEvent, org_name: str | None) -> DeliveryRow:
    details: dict[str, Any] = event.details or {}
    return DeliveryRow(
        id=event.id,
        created_at=event.created_at,
        action=event.action,
        config_source=str(details.get("config_source") or ""),
        organization_id=event.organization_id,
        organization_name=org_name,
        recipient=_first_str(details, "recipient", "recipient_email", "to"),
        template=_first_str(details, "template", "template_name"),
        provider_message_id=_first_str(details, "provider_message_id", "message_id"),
        error=_first_str(details, "error", "error_message"),
    )


def _first_str(d: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = d.get(key)
        if isinstance(value, str) and value:
            return value
    return None
