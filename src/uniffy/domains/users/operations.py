from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.users.cache import invalidate_user_profile
from uniffy.core.valkey.cache import cache_invalidate_by_tag
from uniffy.domains.people.cache import invalidate_chart
from uniffy.domains.users.avatars import (
    delete_avatar as s3_delete_avatar,
)
from uniffy.domains.users.avatars import (
    upload_avatar as s3_upload_avatar,
)
from uniffy.domains.users.search import UserSearchIndexer


class UserOperations:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, user_id: UUID) -> User:
        result = await self._session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise NotFoundError("User", str(user_id))
        return user

    async def _profile_org_id(self, user_id: UUID) -> UUID | None:
        """Most recent active membership; ``None`` when the user has no orgs."""
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

    async def _active_org_ids(self, user_id: UUID) -> list[UUID]:
        result = await self._session.execute(
            select(OrganizationMember.organization_id).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.is_active.is_(True),
            )
        )
        return list(result.scalars().all())

    async def _fan_out_avatar_change(self, user: User) -> None:
        """Every surface that denormalizes the avatar URL bakes in the upload's
        content hash, and the previous hash's objects are gone from S3 by now.
        A surface left unrefreshed serves a URL that 404s into initials.
        """
        await invalidate_user_profile(user.id)
        # Person payloads carry a `user:{id}` tag; the chart is tagged per org only.
        await cache_invalidate_by_tag(f"user:{user.id}")
        indexer = UserSearchIndexer(self._session)
        for organization_id in await self._active_org_ids(user.id):
            await invalidate_chart(organization_id)
            await indexer.index_for_organization(user, organization_id)

    async def update_profile(
        self,
        user_id: UUID,
        accent_color: str | None = None,
        font_family: str | None = None,
        pronouns: str | None = None,
    ) -> User:
        """Self-service covers appearance + pronouns; identity (name, username,
        email) is platform-admin / directory-sync territory, never self-edit.
        """
        user = await self.get_by_id(user_id)

        pronouns_changed = False
        if accent_color is not None:
            user.accent_color = accent_color
        if font_family is not None:
            user.font_family = font_family
        if pronouns is not None:
            if len(pronouns) > 50:
                raise ValidationError("pronouns", "at most 50 characters")
            pronouns_changed = user.pronouns != (pronouns or None)
            user.pronouns = pronouns or None

        await self._session.commit()
        await self._session.refresh(user)

        await invalidate_user_profile(user_id)
        if pronouns_changed:
            # People payload caches carry pronouns and are tagged per user.
            await cache_invalidate_by_tag(f"user:{user_id}")

        return user

    async def upload_avatar(
        self,
        user_id: UUID,
        image_data: bytes,
        filename: str,
    ) -> User:
        user = await self.get_by_id(user_id)

        if user.avatar_key:
            await s3_delete_avatar(user.avatar_key)

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

        await self._fan_out_avatar_change(user)

        return user

    async def delete_avatar(self, user_id: UUID) -> User:
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
            await self._fan_out_avatar_change(user)

        return user

    async def require_system_admin(self, user_id: UUID) -> User:
        user = await self.get_by_id(user_id)
        if not user.is_system_admin:
            raise PermissionDeniedError("Requires system admin privileges")
        return user
