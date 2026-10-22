"""First-run setup: the first person on an empty deployment becomes its operator and first owner."""

from __future__ import annotations

from loguru import logger
from sqlalchemy import BigInteger, func, literal, select

from uniffy.core.audit import client_ip_for_rate_limit, email_hash, write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.emails import normalize_email
from uniffy.core.auth.passwords.crypto import hash_password
from uniffy.core.auth.passwords.policy import validate_password
from uniffy.core.auth.setup_state import setup_required
from uniffy.core.errors import SetupAlreadyCompletedError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.organization_member import OrganizationMemberSource
from uniffy.core.models.login.user import User
from uniffy.core.rate_limit import check_rate_limit
from uniffy.core.search import SearchIndexer
from uniffy.domains.auth.contracts import stage_bootstrap_authentication
from uniffy.domains.auth.types import AuthResult
from uniffy.domains.organizations.naming import (
    ensure_slug_available,
    normalize_org_name,
    normalize_slug,
)
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.platform.bootstrap import BOOTSTRAP_LOCK_ID, seed_vapid_keys
from uniffy.domains.platform.directory.operations import derive_username
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="platform.setup")

SETUP_LIMIT_PER_IP = 10
SETUP_WINDOW_SECONDS = 900

MAX_EMAIL_LENGTH = 255
MAX_FULL_NAME_LENGTH = 255


async def setup_deployment(
    *,
    email: str,
    password: str,
    full_name: str | None,
    organization_name: str,
    organization_slug: str | None,
    user_agent: str | None,
    search_indexer: SearchIndexer,
) -> AuthResult:
    """Closes for good once any user exists, so it can stay a public RPC."""
    ip = client_ip_for_rate_limit()
    if ip:
        await check_rate_limit(
            key=f"rl:auth:setup:ip:{ip}",
            limit=SETUP_LIMIT_PER_IP,
            window_seconds=SETUP_WINDOW_SECONDS,
            resource="deployment setup attempts (per ip)",
        )

    email = normalize_email(email)
    if not email or "@" not in email or len(email) > MAX_EMAIL_LENGTH:  # noqa: PLR2004
        raise ValidationError("email", "A valid email address is required")
    validate_password(password)
    display_name = (full_name or "").strip() or email.split("@", 1)[0]
    if len(display_name) > MAX_FULL_NAME_LENGTH:
        raise ValidationError(
            "full_name", f"full_name must be {MAX_FULL_NAME_LENGTH} characters or fewer"
        )
    name = normalize_org_name(organization_name)
    slug = normalize_slug(organization_slug or "", fallback_name=name)

    async with open_session() as session:
        # Every call after first run stops here instead of queueing on the deployment wide lock.
        if not await setup_required(session):
            raise SetupAlreadyCompletedError("Setup is already complete")
        org_ops = OrganizationOperations(session)
        try:
            # The transaction-scoped lock on the bootstrap key serializes setup against
            # bootstrap and a double submit. The startup lock would block the event loop.
            await session.execute(
                select(func.pg_advisory_xact_lock(literal(BOOTSTRAP_LOCK_ID, BigInteger)))
            )
            if not await setup_required(session):
                raise SetupAlreadyCompletedError("Setup is already complete")
            await ensure_slug_available(session, slug)

            user = User(
                email=email,
                username=derive_username(email),
                full_name=display_name,
                hashed_password=hash_password(password),
                is_active=True,
                is_system_admin=True,
                email_verified=True,
            )
            session.add(user)
            await session.flush()

            staged = await org_ops.stage_organization(
                name=name,
                slug=slug,
                owner_user_id=user.id,
                plan="enterprise",
                actor_user_id=user.id,
                owner_source=OrganizationMemberSource.BOOTSTRAP,
            )
            organization = staged.organization
            # The first session skips two-factor enrollment because the account was created in
            # this request. The platform MFA policy applies from the operator's next sign-in.
            result = await stage_bootstrap_authentication(
                session, user, organization, user_agent=user_agent or ""
            )
            await write_audit_event(
                session,
                organization_id=organization.id,
                actor_user_id=user.id,
                action=Action.DEPLOYMENT_SETUP_COMPLETED,
                resource_type=AuditResourceType.ORGANIZATION,
                resource_id=organization.id,
                details={
                    "email_hash": email_hash(email),
                    "slug": slug,
                    "session_id": str(result.session_id),
                },
            )
            await seed_vapid_keys(session, email)
            await session.commit()
        except Exception:
            await session.rollback()
            raise

        await org_ops.finish_organization_create_after_commit(staged, search_indexer=search_indexer)

    logger.info(
        "Deployment setup completed",
        email_hash=email_hash(email),
        organization_id=str(result.organization_id),
        slug=slug,
    )
    return result
