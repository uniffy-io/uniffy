"""Deployment bootstrap for an empty installation."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from loguru import logger
from sqlalchemy import select

logger = logger.bind(component="platform.bootstrap")

BOOTSTRAP_LOCK_ID = 0x756E_6966_6679_5331  # "unifyS1"

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from uniffy.core.search import SearchIndexer
    from uniffy.core.storage import ObjectStorage


async def bootstrap_deployment(
    storage: ObjectStorage,
    search_indexer: SearchIndexer,
) -> None:
    """Provision the default organization if the database is empty.

    Serialised across workers via advisory lock; the existing-org check inside
    keeps the body idempotent for followers.
    """
    from uniffy.infrastructure.database.session import startup_advisory_lock

    with startup_advisory_lock(BOOTSTRAP_LOCK_ID, "deployment bootstrap"):
        await _bootstrap_deployment_locked(storage, search_indexer)


async def _bootstrap_deployment_locked(
    storage: ObjectStorage,
    search_indexer: SearchIndexer,
) -> None:
    # Lazy imports avoid the auth-module circular dependency.
    from uniffy.core.auth.passwords.crypto import hash_password
    from uniffy.core.models import Organization, User
    from uniffy.infrastructure.database.session import open_session

    logger.info("Checking deployment state...")

    async with open_session() as session:
        result = await session.execute(select(Organization).limit(1))
        existing_org = result.scalar_one_or_none()

        if existing_org:
            logger.info("Deployment already initialized. Skipping bootstrap.")
            return

        logger.info("No organizations found. Bootstrapping deployment...")

        try:
            # Bootstrap users. When INITIAL_ADMIN_EMAIL == INITIAL_PLATFORM_ADMIN_EMAIL
            # (case-insensitive) one user holds both roles - the self-hosted
            # single-tenant default. Otherwise admin owns the org and a separate
            # platform user is sysadmin-only with no org membership.
            admin_password = os.getenv("INITIAL_ADMIN_PASSWORD")
            if not admin_password:
                logger.warning(
                    "INITIAL_ADMIN_PASSWORD environment variable not set. "
                    "Using default password: 'admin'"
                )
                admin_password = "admin"

            admin_email = os.getenv("INITIAL_ADMIN_EMAIL", "admin@uniffy.io")
            platform_email = os.getenv("INITIAL_PLATFORM_ADMIN_EMAIL", "").strip() or admin_email
            platform_password = (
                os.getenv("INITIAL_PLATFORM_ADMIN_PASSWORD", "").strip() or admin_password
            )

            collapsed = admin_email.strip().lower() == platform_email.strip().lower()

            admin_user = User(
                email=admin_email,
                username="admin",
                full_name="System Administrator",
                hashed_password=hash_password(admin_password),
                is_active=True,
                is_system_admin=collapsed,
                email_verified=True,
            )
            session.add(admin_user)
            await session.flush()
            await session.refresh(admin_user)

            if collapsed:
                logger.info(f"Created combined admin + platform user: {admin_user.email}")
            else:
                logger.info(f"Created org-owner user: {admin_user.email}")
                platform_user = User(
                    email=platform_email,
                    username="platform",
                    full_name="Platform Operator",
                    hashed_password=hash_password(platform_password),
                    is_active=True,
                    is_system_admin=True,
                    email_verified=True,
                )
                session.add(platform_user)
                await session.flush()
                await session.refresh(platform_user)
                logger.info(f"Created platform-admin-only user: {platform_user.email}")

            from uniffy.domains.organizations.operations import OrganizationOperations

            org_name = os.getenv("DEFAULT_ORG_NAME", "Default")
            org_slug = os.getenv("DEFAULT_ORG_SLUG")
            if not org_slug:
                from uniffy.core.types import slugify

                org_slug = slugify(org_name)

            org_ops = OrganizationOperations(session)
            default_org = await org_ops.create(
                name=org_name,
                slug=org_slug,
                owner_user_id=admin_user.id,
                plan="enterprise",
                storage=storage,
                search_indexer=search_indexer,
            )
            logger.info(f"Created default organization: {default_org.name} ({default_org.slug})")

            await _seed_vapid_keys(session, admin_email)

            await session.commit()
            logger.info("Deployment bootstrap completed successfully.")

        except Exception as e:
            await session.rollback()
            logger.error(f"Failed to bootstrap deployment: {e}")
            raise


async def _seed_vapid_keys(session: AsyncSession, admin_email: str) -> None:
    """Generate a VAPID keypair and store it in deployment_settings, once."""
    import base64

    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    from uniffy.core.config.push import (
        PUSH_SETTINGS_NAMESPACE,
        VAPID_CONTACT_EMAIL_KEY,
        VAPID_PRIVATE_KEY,
        VAPID_PUBLIC_KEY,
    )
    from uniffy.core.config.settings import DeploymentSettingsOperations

    settings = DeploymentSettingsOperations(session)

    # Regenerating the keypair would silently invalidate every existing push
    # subscription, so a present key means we leave it untouched.
    existing = await settings.get_namespace(PUSH_SETTINGS_NAMESPACE)
    if VAPID_PUBLIC_KEY in existing:
        return

    private_key = ec.generate_private_key(ec.SECP256R1())

    # VAPID requires base64url without padding (RFC 8292).
    priv_numbers = private_key.private_numbers()
    priv_bytes = priv_numbers.private_value.to_bytes(32, byteorder="big")
    priv_b64 = base64.urlsafe_b64encode(priv_bytes).rstrip(b"=").decode("ascii")

    pub_bytes = private_key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    pub_b64 = base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode("ascii")

    await settings.set(
        namespace=PUSH_SETTINGS_NAMESPACE,
        key=VAPID_PRIVATE_KEY,
        value=priv_b64,
        is_secret=True,
    )
    await settings.set(namespace=PUSH_SETTINGS_NAMESPACE, key=VAPID_PUBLIC_KEY, value=pub_b64)
    await settings.set(
        namespace=PUSH_SETTINGS_NAMESPACE,
        key=VAPID_CONTACT_EMAIL_KEY,
        value=f"mailto:{admin_email}",
    )
    await session.flush()
    logger.info("Generated and stored VAPID keypair in deployment_settings")
