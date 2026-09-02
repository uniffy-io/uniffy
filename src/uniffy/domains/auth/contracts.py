"""Narrow auth staging contracts for composite identity flows."""

import hashlib
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import audit_ip_var
from uniffy.core.auth.devices import parse_device_label
from uniffy.core.auth.domain_admin import get_user_domain_admins
from uniffy.core.auth.passwords.crypto import hash_password
from uniffy.core.auth.passwords.policy import validate_password
from uniffy.core.auth.tokens import create_access_token, create_refresh_token
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.domains.auth.mfa.challenge import create_enrollment_only_token
from uniffy.domains.auth.mfa.enforcement import MfaRequirement, evaluate_mfa_requirement
from uniffy.domains.auth.types import AuthResult, MfaEnrollmentRequired


@dataclass(frozen=True)
class StagedInvitationAuthentication:
    outcome: AuthResult | MfaEnrollmentRequired
    session_id: UUID | None
    enrollment_required: bool


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def stage_invited_user(
    session: AsyncSession,
    *,
    email: str,
    username: str,
    password: str,
    full_name: str | None,
) -> User:
    validate_password(password)
    user = User(
        email=email,
        username=username,
        hashed_password=hash_password(password),
        full_name=full_name,
    )
    session.add(user)
    await session.flush()
    return user


async def stage_invitation_authentication(
    session: AsyncSession,
    *,
    user: User,
    organization_id: UUID,
    organization_slug: str,
    organization_role: OrganizationRole,
    user_agent: str,
) -> StagedInvitationAuthentication:
    requirement = await evaluate_mfa_requirement(session, user=user, user_mfa=None)
    if requirement.requirement == MfaRequirement.HARD_REQUIRED:
        enrollment_token = create_enrollment_only_token(
            user.id,
            organization_id=organization_id,
            token_version=user.token_version,
        )
        return StagedInvitationAuthentication(
            outcome=MfaEnrollmentRequired(
                enrollment_token=enrollment_token,
                grace_expires_at=None,
            ),
            session_id=None,
            enrollment_required=True,
        )

    session_record = UserSession(
        user_id=user.id,
        organization_id=organization_id,
        user_agent=user_agent[:512],
        device_label=parse_device_label(user_agent),
        ip_address=(audit_ip_var.get() or "")[:45],
    )
    session.add(session_record)
    await session.flush()

    access_token = create_access_token(
        user.id,
        organization_id,
        token_version=user.token_version,
        session_id=session_record.id,
        full_name=user.full_name,
        avatar_key=user.avatar_key,
    )
    refresh_token = create_refresh_token(
        user.id,
        token_version=user.token_version,
        session_id=session_record.id,
    )
    session_record.refresh_token_hash = hash_refresh_token(refresh_token)
    domain_admins = await get_user_domain_admins(session, user.id, organization_id)

    return StagedInvitationAuthentication(
        outcome=AuthResult(
            access_token=access_token,
            refresh_token=refresh_token,
            user_id=user.id,
            organization_id=organization_id,
            organization_slug=organization_slug,
            organization_role=organization_role.value,
            session_id=session_record.id,
            domain_admin_domains=[domain.value for domain in domain_admins],
        ),
        session_id=session_record.id,
        enrollment_required=False,
    )
