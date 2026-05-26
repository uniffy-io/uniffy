"""User management operations."""

import hashlib
import os
from uuid import UUID

from sqlalchemy import delete as sql_delete
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.realtime.publisher import publish_token_revoke
from uniffy.core.users.cache import invalidate_user_profile
from uniffy.domains.users.avatars import (
    delete_avatar as s3_delete_avatar,
)
from uniffy.domains.users.avatars import (
    upload_avatar as s3_upload_avatar,
)
from uniffy.domains.users.search import UserSearchIndexer


def _email_hash(email: str | None) -> str | None:
    """SHA-256 of the lower-cased email; identifies a value without
    storing it directly in the audit payload."""
    if not email:
        return None
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()


class UserOperations:
    """User management operations."""

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize user operations.

        Parameters
        ----------
        session : AsyncSession
            Database session.

        """
        self._session = session
        self._user_indexer = UserSearchIndexer(session)

    async def get_by_id(self, user_id: UUID) -> User:
        """
        Get user by ID.

        Parameters
        ----------
        user_id : UUID
            User ID.

        Returns
        -------
        User
            User instance.

        Raises
        ------
        NotFoundError
            If user not found.

        """
        result = await self._session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise NotFoundError("User", str(user_id))
        return user

    async def get_by_email(self, email: str) -> User | None:
        """
        Get user by email.

        Parameters
        ----------
        email : str
            User email.

        Returns
        -------
        User | None
            User if found, None otherwise.

        """
        result = await self._session.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def _profile_org_id(self, user_id: UUID) -> UUID | None:
        """Best-effort primary org for self-profile audit emission.

        Picks the most recent active membership. ``None`` if the user
        belongs to no orgs - the audit row still emits with ``None``
        for tenant context.
        """
        result = await self._session.execute(
            select(OrganizationMember.organization_id)
            .where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.is_active.is_(True),
            )
            .order_by(OrganizationMember.joined_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def update_profile(
        self,
        user_id: UUID,
        full_name: str | None = None,
        username: str | None = None,
        accent_color: str | None = None,
        font_family: str | None = None,
    ) -> User:
        """
        Update user's own profile.

        Parameters
        ----------
        user_id : UUID
            User ID.
        full_name : str | None
            New full name.
        username : str | None
            New username.
        accent_color : str | None
            New accent color.
        font_family : str | None
            New font family.

        Returns
        -------
        User
            Updated user.

        """
        user = await self.get_by_id(user_id)

        # Track if searchable fields changed
        searchable_changed = full_name is not None or username is not None

        if full_name is not None:
            user.full_name = full_name
        if username is not None:
            user.username = username
        if accent_color is not None:
            user.accent_color = accent_color
        if font_family is not None:
            user.font_family = font_family

        await self._session.commit()
        await self._session.refresh(user)

        # Re-index for all orgs if searchable fields changed
        if searchable_changed:
            await self._user_indexer.index_for_all_organizations(user)
            await self._session.commit()

        await invalidate_user_profile(user_id)

        return user

    async def admin_update(
        self,
        user_id: UUID,
        full_name: str | None = None,
        username: str | None = None,
        email: str | None = None,
        is_active: bool | None = None,
        is_system_admin: bool | None = None,
        hashed_password: str | None = None,
        actor_user_id: UUID | None = None,
    ) -> User:
        """
        Admin update of user (system admin only).

        Parameters
        ----------
        user_id : UUID
            User ID to update.
        full_name : str | None
            New full name.
        username : str | None
            New username.
        email : str | None
            New email.
        is_active : bool | None
            Active status.
        is_system_admin : bool | None
            System admin status.
        hashed_password : str | None
            New hashed password.

        Returns
        -------
        User
            Updated user.

        """
        user = await self.get_by_id(user_id)

        # Track if searchable fields changed
        searchable_changed = any([
            full_name is not None,
            username is not None,
            email is not None,
        ])

        was_deactivated = is_active is False and user.is_active is True
        was_activated = is_active is True and user.is_active is False
        previous_email = user.email

        if full_name is not None:
            user.full_name = full_name
        if username is not None:
            user.username = username
        if email is not None:
            user.email = email
        if is_active is not None:
            user.is_active = is_active
            # Increment token_version on deactivation to immediately revoke all tokens
            if was_deactivated:
                user.token_version += 1
                user.cache_key_seed = os.urandom(32)
        if is_system_admin is not None:
            user.is_system_admin = is_system_admin
        if hashed_password is not None:
            user.hashed_password = hashed_password
            user.token_version += 1  # Invalidate existing tokens on password change
            user.cache_key_seed = os.urandom(32)  # Invalidate all device caches

        token_revoked = was_deactivated or hashed_password is not None

        admin_org_id = (
            await self._profile_org_id(actor_user_id) if actor_user_id else None
        )

        if was_activated:
            await write_audit_event(
                self._session,
                organization_id=admin_org_id,
                actor_user_id=actor_user_id,
                action=Action.USER_ACTIVATED,
                resource_type="USER",
                resource_id=user_id,
            )
        if was_deactivated:
            await write_audit_event(
                self._session,
                organization_id=admin_org_id,
                actor_user_id=actor_user_id,
                action=Action.USER_DEACTIVATED,
                resource_type="USER",
                resource_id=user_id,
            )
        if email is not None and email != previous_email:
            await write_audit_event(
                self._session,
                organization_id=admin_org_id,
                actor_user_id=actor_user_id,
                action=Action.USER_EMAIL_CHANGED,
                resource_type="USER",
                resource_id=user_id,
                details={
                    "previous_email_hash": _email_hash(previous_email),
                    "new_email_hash": _email_hash(email),
                },
            )
        if hashed_password is not None:
            await write_audit_event(
                self._session,
                organization_id=admin_org_id,
                actor_user_id=actor_user_id,
                action=Action.AUTH_PASSWORD_CHANGED,
                resource_type="USER",
                resource_id=user_id,
                details={
                    "initiator": "admin" if actor_user_id != user_id else "self",
                },
            )

        await self._session.commit()
        await self._session.refresh(user)

        # Handle search index updates
        if was_deactivated:
            # Remove from search index when deactivated
            await self._user_indexer.remove_completely(user.id)
            await self._session.commit()
        elif searchable_changed:
            # Re-index for all orgs if searchable fields changed
            await self._user_indexer.index_for_all_organizations(user)
            await self._session.commit()

        await invalidate_user_profile(user_id)

        if token_revoked:
            from uniffy.domains.auth.revocation import mark_token_version_revoked

            await mark_token_version_revoked(user_id, user.token_version)
            await publish_token_revoke(user_id, user.token_version)

        return user

    async def admin_create(
        self,
        email: str,
        username: str,
        hashed_password: str,
        full_name: str | None = None,
        is_system_admin: bool = False,
        actor_user_id: UUID | None = None,
    ) -> User:
        """
        Admin create user (system admin only).

        Parameters
        ----------
        email : str
            User email.
        username : str
            Username.
        hashed_password : str
            Pre-hashed password.
        full_name : str | None
            Full name.
        is_system_admin : bool
            System admin status.

        Returns
        -------
        User
            Created user.

        """
        user = User(
            email=email,
            username=username,
            hashed_password=hashed_password,
            full_name=full_name,
            is_active=True,
            is_system_admin=is_system_admin,
            email_verified=False,
        )
        self._session.add(user)
        await self._session.commit()
        await self._session.refresh(user)

        admin_org_id = (
            await self._profile_org_id(actor_user_id) if actor_user_id else None
        )
        await write_audit_event(
            self._session,
            organization_id=admin_org_id,
            actor_user_id=actor_user_id,
            action=Action.USER_INVITED,
            resource_type="USER",
            resource_id=user.id,
            details={
                "email_hash": _email_hash(email),
                "is_system_admin": is_system_admin,
            },
        )
        await self._session.commit()
        return user

    async def delete(self, user_id: UUID, actor_user_id: UUID | None = None) -> bool:
        """
        Delete a user (system admin only).

        Parameters
        ----------
        user_id : UUID
            User ID to delete.

        Returns
        -------
        bool
            True if deleted successfully.

        Raises
        ------
        NotFoundError
            If user not found.

        """
        user = await self.get_by_id(user_id)

        # Remove from search index
        await self._user_indexer.remove_completely(user.id)

        # Delete organization memberships first
        await self._session.execute(
            sql_delete(OrganizationMember).where(OrganizationMember.user_id == user_id)
        )

        admin_org_id = (
            await self._profile_org_id(actor_user_id) if actor_user_id else None
        )
        await write_audit_event(
            self._session,
            organization_id=admin_org_id,
            actor_user_id=actor_user_id,
            action=Action.USER_DELETED,
            resource_type="USER",
            resource_id=user_id,
            details={"email_hash": _email_hash(user.email)},
        )

        await self._session.delete(user)
        await self._session.commit()

        await invalidate_user_profile(user_id)

        return True

    async def list_all(
        self,
        page: int = 1,
        page_size: int = 20,
        query_str: str | None = None,
        include_inactive: bool = False,
    ) -> tuple[list[User], int]:
        """
        List all users with pagination (system admin only).

        Parameters
        ----------
        page : int
            Page number (1-indexed).
        page_size : int
            Items per page.
        query_str : str | None
            Optional search query.
        include_inactive : bool
            Whether to include inactive users.

        Returns
        -------
        tuple[list[User], int]
            List of users and total count.

        """
        query = select(User)

        if not include_inactive:
            query = query.where(User.is_active.is_(True))

        if query_str:
            pattern = f"%{query_str}%"
            query = query.where(
                or_(
                    User.email.ilike(pattern),
                    User.username.ilike(pattern),
                    User.full_name.ilike(pattern),
                )
            )

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self._session.execute(count_query)).scalar() or 0

        # Apply pagination
        query = query.order_by(User.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        users = list(result.scalars().all())

        return users, total

    async def upload_avatar(
        self,
        user_id: UUID,
        image_data: bytes,
        filename: str,
    ) -> User:
        """
        Upload and set user avatar.

        Validates, resizes to 3 sizes (sm/md/lg), uploads to S3, and updates user record.
        Deletes any existing avatar before setting the new one.

        Parameters
        ----------
        user_id : UUID
            User ID.
        image_data : bytes
            Raw image bytes.
        filename : str
            Original filename for MIME type detection.

        Returns
        -------
        User
            Updated user.

        Raises
        ------
        ValueError
            If image validation fails.

        """
        user = await self.get_by_id(user_id)

        # Delete old avatar from S3 if exists
        if user.avatar_key:
            await s3_delete_avatar(user.avatar_key)

        # Upload new avatar
        avatar_key = await s3_upload_avatar(user_id, image_data, filename)
        user.avatar_key = avatar_key

        org_id = await self._profile_org_id(user_id)
        await write_audit_event(
            self._session,
            organization_id=org_id,
            actor_user_id=user_id,
            action=Action.USER_AVATAR_CHANGED,
            resource_type="USER",
            resource_id=user_id,
            details={"change": "set"},
        )

        await self._session.commit()
        await self._session.refresh(user)

        await invalidate_user_profile(user_id)

        return user

    async def delete_avatar(self, user_id: UUID) -> User:
        """
        Delete user avatar.

        Removes avatar images from S3 and clears the avatar_key on the user.

        Parameters
        ----------
        user_id : UUID
            User ID.

        Returns
        -------
        User
            Updated user.

        """
        user = await self.get_by_id(user_id)

        if user.avatar_key:
            await s3_delete_avatar(user.avatar_key)
            user.avatar_key = None

            org_id = await self._profile_org_id(user_id)
            await write_audit_event(
                self._session,
                organization_id=org_id,
                actor_user_id=user_id,
                action=Action.USER_AVATAR_CHANGED,
                resource_type="USER",
                resource_id=user_id,
                details={"change": "cleared"},
            )

            await self._session.commit()
            await self._session.refresh(user)
            await invalidate_user_profile(user_id)

        return user

    async def require_system_admin(self, user_id: UUID) -> User:
        """
        Get user and verify they are system admin.

        Parameters
        ----------
        user_id : UUID
            User ID.

        Returns
        -------
        User
            User instance.

        Raises
        ------
        NotFoundError
            If user not found.
        PermissionDeniedError
            If user is not system admin.

        """
        user = await self.get_by_id(user_id)
        if not user.is_system_admin:
            raise PermissionDeniedError("Requires system admin privileges")
        return user
