"""Database seeding module."""

import logging
import os

from sqlalchemy import select

from uwos.auth.password import hash_password
from uwos.db.session import get_async_session
from uwos.models import Organization, OrganizationMember, OrganizationRole, User

logger = logging.getLogger(__name__)


async def seed_initial_data() -> None:
    """
    Seed initial data if the database is empty.

    Creates a default organization and a system admin user.
    """
    logger.info("Checking for existing data...")

    async for session in get_async_session():
        # Check for existing organizations
        result = await session.execute(select(Organization).limit(1))
        existing_org = result.scalar_one_or_none()

        if existing_org:
            logger.info("Database already seeded. Skipping initialization.")
            return

        logger.info("No organizations found. Seeding initial data...")

        try:
            # 1. Create Default Organization
            default_org = Organization(
                name="Default", slug="default", plan="enterprise", is_active=True
            )
            session.add(default_org)
            await session.flush()  # flush to get the ID
            await session.refresh(default_org)
            logger.info(f"Created default organization: {default_org.name}")

            # 2. Create System Admin User
            admin_password = os.getenv("INITIAL_ADMIN_PASSWORD")
            if not admin_password:
                logger.warning(
                    "INITIAL_ADMIN_PASSWORD environment variable not set. "
                    "Using default password: 'admin'"
                )
                admin_password = "admin"

            admin_user = User(
                email="admin@uwos.io",
                username="admin",
                full_name="System Administrator",
                hashed_password=hash_password(admin_password),
                is_active=True,
                is_system_admin=True,
                email_verified=True,
            )
            session.add(admin_user)
            await session.flush()
            await session.refresh(admin_user)
            logger.info(f"Created system admin user: {admin_user.username}")

            # 3. Add Admin to Organization
            member = OrganizationMember(
                user_id=admin_user.id,
                organization_id=default_org.id,
                role=OrganizationRole.OWNER,
                is_active=True,
            )
            session.add(member)

            await session.commit()
            logger.info("Initial data seeding completed successfully.")

        except Exception as e:
            await session.rollback()
            logger.error(f"Failed to seed initial data: {e}")
            raise
