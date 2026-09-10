"""Calendar operations."""

from uuid import UUID

from loguru import logger
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.membership import get_active_membership
from uniffy.core.auth.permissions import resolve_creation_policy
from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
)
from uniffy.core.models.calendar.template import EventTemplate
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
)

logger = logger.bind(component="scheduling.calendar.templates.operations")


class EventTemplateOperations:
    """EventTemplate CRUD. Org-scoped; not indexed for search."""

    def __init__(self, session: AsyncSession) -> None:
        from uniffy.core.auth.permissions.queries import ContentAccessQuery

        self.session = session
        self.access_query = ContentAccessQuery(session)

    async def _verify_org_membership(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        if await get_active_membership(self.session, user_id, organization_id) is None:
            raise PermissionDeniedError("access", "organization")

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        title: str,
        description: str = "",
        duration_minutes: int = 30,
        location: str = "",
        meeting_url: str | None = None,
        category_id: UUID | None = None,
        tags: list[str] | None = None,
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
    ) -> EventTemplate:
        await self._verify_org_membership(user_id, organization_id)

        access_mode, baseline_role = await resolve_creation_policy(
            self.session,
            organization_id,
            ContentType.CALENDAR_EVENT,
            access_mode,
            baseline_role,
        )

        template = EventTemplate(
            organization_id=organization_id,
            title=title,
            description=description,
            duration_minutes=duration_minutes,
            location=location,
            meeting_url=meeting_url,
            category_id=category_id,
            tags=tags or [],
            access_mode=access_mode,
            baseline_role=baseline_role,
            created_by=user_id,
        )
        self.session.add(template)
        await self.session.commit()
        await self.session.refresh(template)
        return template

    async def get_by_id(
        self,
        template_id: UUID,
        organization_id: UUID,
        user_id: UUID,
    ) -> EventTemplate:
        """Get a template by ID, enforcing access policy."""

        await self._verify_org_membership(user_id, organization_id)

        query = select(EventTemplate).where(
            and_(
                EventTemplate.id == template_id,
                EventTemplate.organization_id == organization_id,
            )
        )
        result = await self.session.execute(query)
        template = result.scalar_one_or_none()

        if not template:
            raise NotFoundError("EventTemplate", template_id)

        from uniffy.core.auth.permissions import resolve_effective_policy
        from uniffy.core.auth.permissions.defaults import resolve_content_defaults

        default_mode, default_baseline = await resolve_content_defaults(
            self.session,
            organization_id,
            ContentType.CALENDAR_EVENT,
        )
        effective_mode, _ = resolve_effective_policy(
            template.access_mode,
            template.baseline_role,
            default_mode,
            default_baseline,
        )
        if effective_mode == AccessMode.OWNER_ONLY and template.created_by != user_id:
            raise PermissionDeniedError("read", "event template")

        return template

    async def update(
        self,
        template_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        **kwargs,
    ) -> EventTemplate:
        """Update a template (creator only)."""
        template = await self.get_by_id(template_id, organization_id, user_id)

        if template.created_by != user_id:
            raise PermissionDeniedError("update", "event template")

        for key, value in kwargs.items():
            if hasattr(template, key):
                setattr(template, key, value)

        await self.session.commit()
        await self.session.refresh(template)
        return template

    async def delete(
        self,
        template_id: UUID,
        organization_id: UUID,
        user_id: UUID,
    ) -> bool:
        """Delete a template (creator only)."""
        template = await self.get_by_id(template_id, organization_id, user_id)

        if template.created_by != user_id:
            raise PermissionDeniedError("delete", "event template")

        await self.session.delete(template)
        await self.session.commit()
        return True

    async def list(
        self,
        organization_id: UUID,
        user_id: UUID,
    ) -> list[EventTemplate]:
        """List templates visible to the user."""
        await self._verify_org_membership(user_id, organization_id)

        access_filter = await self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.CALENDAR_EVENT,
            content_id_column=EventTemplate.id,
            owner_id_column=EventTemplate.created_by,
            access_mode_column=EventTemplate.access_mode,
            baseline_role_column=EventTemplate.baseline_role,
        )
        query = select(EventTemplate).where(
            EventTemplate.organization_id == organization_id,
            access_filter,
        )

        result = await self.session.execute(query)
        return list(result.scalars().all())
