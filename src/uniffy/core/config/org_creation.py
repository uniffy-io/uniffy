"""Resolve who may create organizations through the tenant surface."""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.config.settings import DeploymentSettingsOperations
from uniffy.core.config.source import SettingSource
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User

logger = logger.bind(component="core.config.org_creation")

ORG_CREATION_NAMESPACE = "system"
ORG_CREATION_KEY = "org_creation"
_ORG_CREATION_ENV = "ALLOW_ORG_CREATION"


class OrgCreationPolicy(StrEnum):
    """Each level adds to the one before it; platform operators may always create."""

    OPERATORS_ONLY = "operators_only"
    OPERATORS_AND_OWNERS = "operators_and_owners"
    MEMBERS = "members"
    ANYONE = "anyone"


DEFAULT_ORG_CREATION_POLICY = OrgCreationPolicy.OPERATORS_AND_OWNERS


@dataclass(frozen=True, slots=True)
class OrgCreationState:
    policy: OrgCreationPolicy
    source: SettingSource


def _parse_policy(raw: object, *, source: SettingSource) -> OrgCreationPolicy | None:
    """An unknown value counts as unset, so a typo falls through to the next tier."""
    if isinstance(raw, str):
        try:
            return OrgCreationPolicy(raw.strip().lower())
        except ValueError:
            pass
    logger.warning(
        "Ignoring an unknown organization creation policy",
        value=repr(raw),
        source=source.value,
    )
    return None


async def resolve_org_creation(session: AsyncSession) -> OrgCreationState:
    rows = await DeploymentSettingsOperations(session).get_namespace(ORG_CREATION_NAMESPACE)
    row = rows.get(ORG_CREATION_KEY)
    if row is not None and not row.is_secret:
        policy = _parse_policy(row.value, source=SettingSource.DEPLOYMENT)
        if policy is not None:
            return OrgCreationState(policy=policy, source=SettingSource.DEPLOYMENT)

    raw = os.getenv(_ORG_CREATION_ENV)
    if raw is not None and raw.strip():
        policy = _parse_policy(raw, source=SettingSource.ENV)
        if policy is not None:
            return OrgCreationState(policy=policy, source=SettingSource.ENV)
    return OrgCreationState(policy=DEFAULT_ORG_CREATION_POLICY, source=SettingSource.DEFAULT)


async def org_creation_policy(session: AsyncSession) -> OrgCreationPolicy:
    return (await resolve_org_creation(session)).policy


async def user_can_create_organization(session: AsyncSession, user: User) -> bool:
    if not user.is_active:
        return False
    if user.is_system_admin:
        return True
    policy = await org_creation_policy(session)
    if policy is OrgCreationPolicy.ANYONE:
        return True
    if policy is OrgCreationPolicy.OPERATORS_ONLY:
        return False
    return await _holds_active_membership(
        session,
        user.id,
        owner_only=policy is OrgCreationPolicy.OPERATORS_AND_OWNERS,
    )


async def _holds_active_membership(
    session: AsyncSession, user_id: UUID, *, owner_only: bool
) -> bool:
    """Suspended organizations count as no membership, as they do in every access gate."""
    query = (
        select(OrganizationMember.id)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.is_active.is_(True),
            Organization.deleted_at.is_(None),
            Organization.is_suspended.is_(False),
        )
        .limit(1)
    )
    if owner_only:
        query = query.where(OrganizationMember.role == OrganizationRole.OWNER)
    return (await session.execute(query)).scalar_one_or_none() is not None
