"""MFA enforcement policy evaluator.

Called once per password-correct login (inside ``AuthOperations.authenticate``)
to decide whether the user lands in a normal session or in
``EnrollmentRequired`` mid-login state.

Two states only:

* ``NOT_REQUIRED`` -- no policy requires MFA for this user/org.
* ``HARD_REQUIRED`` -- policy requires it and the user has not
  enrolled. The caller returns an ``EnrollmentRequired`` outcome with
  a 30-min enrollment-only JWT; nothing else is issued.

Sources of policy:

* ``SecurityOperations.get(org_id)`` -- org-tier flags
  ``mfa_required_for_members`` / ``mfa_required_for_admins``.
* ``MfaPolicyOperations.get()`` -- deployment-tier
  ``required_for_system_admins``.

Grace windows were considered and removed: when an admin flips the
toggle they expect the next sign in to enforce it, not seven days
later. If a rollout grace becomes useful again, it can live as a
separate per-organization-member nudge instead of a hidden delay on
the requirement itself.

Fail-open: when policy cannot be loaded (Valkey hiccup, missing org
row) the evaluator returns ``NOT_REQUIRED`` so a backend hiccup never
locks a user out of their own account.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_mfa import UserMfa
from uniffy.domains.auth.mfa.policy import MfaPolicyOperations
from uniffy.domains.security.operations import SecurityOperations


class MfaRequirement(str, Enum):
    """Two-valued result of policy evaluation."""

    NOT_REQUIRED = "not_required"
    HARD_REQUIRED = "hard_required"


@dataclass(frozen=True)
class MfaRequirementResult:
    """Effective MFA requirement for a single login attempt."""

    requirement: MfaRequirement


async def evaluate_mfa_requirement(
    session: AsyncSession,
    *,
    user: User,
    user_mfa: UserMfa | None,
) -> MfaRequirementResult:
    """Decide whether the caller must enrol before getting real tokens.

    Assumes ``user_mfa.enabled`` is False (or the row is absent). When
    a user already has MFA enabled, the caller short-circuits to the
    challenge flow before this function is called.

    Enforcement scans every active org membership rather than the
    org the user is currently entering: the login UI does not ask for
    an org context, MFA secrets are per user (one secret protects
    every membership), and an admin who flips "Require MFA for
    admins" expects the next sign-in to enforce it regardless of which
    org the user happens to land in first.
    """
    if user_mfa is not None and user_mfa.enabled:
        return MfaRequirementResult(MfaRequirement.NOT_REQUIRED)

    try:
        required = await _is_required(session, user=user)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "mfa.enforcement: policy lookup failed, defaulting to not_required",
            error=str(exc),
        )
        return MfaRequirementResult(MfaRequirement.NOT_REQUIRED)

    if not required:
        return MfaRequirementResult(MfaRequirement.NOT_REQUIRED)
    return MfaRequirementResult(MfaRequirement.HARD_REQUIRED)


async def _is_required(session: AsyncSession, *, user: User) -> bool:
    """True when any platform or org policy obliges this user to enrol."""
    if user.is_system_admin:
        policy = await MfaPolicyOperations(session).get()
        if policy.required_for_system_admins:
            return True

    result = await session.execute(
        select(OrganizationMember.organization_id, OrganizationMember.role).where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.is_active.is_(True),
        )
    )
    memberships = list(result.all())
    if not memberships:
        return False

    security_ops = SecurityOperations(session)
    for org_id, role in memberships:
        settings = await security_ops.get(org_id)
        role_str = role.value if hasattr(role, "value") else str(role)
        if role_str.upper() in {"OWNER", "ADMIN"} and settings.mfa_required_for_admins:
            return True
        if settings.mfa_required_for_members:
            return True
    return False
