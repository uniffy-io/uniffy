from collections import defaultdict
from collections.abc import Collection
from datetime import UTC, datetime
from time import perf_counter
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.files.attachment import Attachment
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.types import ContentRole, ContentType, SubjectType
from uniffy.domains.calendar.access import resolve_calendar_events
from uniffy.domains.chat.resources.access import resolve_chat_resources
from uniffy.domains.people.directory.access import resolve_directory_resources
from uniffy.domains.permissions.access.registry import (
    CHAT_CONTENT_TYPES,
    DIRECT_CONTENT_TYPES,
    DIRECTORY_CONTENT_TYPES,
)
from uniffy.domains.permissions.access.standard import (
    resolve_cron_tasks,
    resolve_direct,
)
from uniffy.domains.permissions.access.subject import (
    AccessSubject,
    load_access_subject,
)
from uniffy.domains.permissions.access.types import (
    ResourceAccessDecision,
    ResourceAccessPurpose,
    ResourceKey,
    ResourceRowState,
    missing_decision,
)
from uniffy.domains.permissions.metrics import (
    RESOURCE_ACCESS_CANDIDATES,
    RESOURCE_ACCESS_DURATION,
)
from uniffy.domains.projects.access import resolve_tasks
from uniffy.domains.tags.access import resolve_tags

MAX_RESOURCE_BATCH = 300
MAX_RESOURCE_PAGE = 500


class ResourceAccessResolver:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._subjects: dict[tuple[UUID, UUID], AccessSubject] = {}

    async def subject(self, *, actor_id: UUID, organization_id: UUID) -> AccessSubject:
        subject_key = (actor_id, organization_id)
        subject = self._subjects.get(subject_key)
        if subject is None:
            subject = await load_access_subject(
                self.session,
                user_id=actor_id,
                organization_id=organization_id,
            )
            self._subjects[subject_key] = subject
        return subject

    async def resolve(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        keys: Collection[ResourceKey],
        purpose: ResourceAccessPurpose,
    ) -> dict[ResourceKey, ResourceAccessDecision]:
        unique_keys = tuple(dict.fromkeys(keys))
        if len(unique_keys) > MAX_RESOURCE_BATCH:
            raise ValueError(f"At most {MAX_RESOURCE_BATCH} resources may be authorized at once")
        purpose_label = purpose.value
        RESOURCE_ACCESS_CANDIDATES.labels(purpose=purpose_label).observe(len(unique_keys))
        started = perf_counter()
        try:
            subject = await self.subject(actor_id=actor_id, organization_id=organization_id)
            return await self._resolve_with_subject(subject, unique_keys)
        finally:
            RESOURCE_ACCESS_DURATION.labels(purpose=purpose_label).observe(perf_counter() - started)

    async def resolve_page(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        keys: Collection[ResourceKey],
    ) -> dict[ResourceKey, ResourceAccessDecision]:
        unique_keys = tuple(dict.fromkeys(keys))
        if len(unique_keys) > MAX_RESOURCE_PAGE:
            raise ValueError(f"At most {MAX_RESOURCE_PAGE} resources may be authorized per page")
        decisions: dict[ResourceKey, ResourceAccessDecision] = {}
        for start in range(0, len(unique_keys), MAX_RESOURCE_BATCH):
            decisions.update(
                await self.resolve(
                    actor_id=actor_id,
                    organization_id=organization_id,
                    keys=unique_keys[start : start + MAX_RESOURCE_BATCH],
                    purpose=ResourceAccessPurpose.LIST,
                )
            )
        return decisions

    async def _resolve_with_subject(
        self,
        subject: AccessSubject,
        keys: Collection[ResourceKey],
        *,
        include_attachment_files: bool = True,
    ) -> dict[ResourceKey, ResourceAccessDecision]:
        grouped: dict[ContentType, set[UUID]] = defaultdict(set)
        for key in keys:
            grouped[key.content_type].add(key.content_id)
        decisions = {key: missing_decision(key) for key in keys}

        if DIRECT_CONTENT_TYPES & grouped.keys():
            decisions.update(await resolve_direct(self.session, subject, grouped))
        if ContentType.AGENT_CRON_TASK in grouped:
            decisions.update(
                await resolve_cron_tasks(
                    self.session,
                    subject,
                    grouped[ContentType.AGENT_CRON_TASK],
                )
            )
        if ContentType.CALENDAR_EVENT in grouped:
            decisions.update(
                await resolve_calendar_events(
                    self.session,
                    subject,
                    grouped[ContentType.CALENDAR_EVENT],
                )
            )
        if ContentType.TASK in grouped:
            decisions.update(await resolve_tasks(self.session, subject, grouped[ContentType.TASK]))
        if CHAT_CONTENT_TYPES & grouped.keys():
            decisions.update(await resolve_chat_resources(self.session, subject, grouped))
        if DIRECTORY_CONTENT_TYPES & grouped.keys():
            decisions.update(await resolve_directory_resources(self.session, subject, grouped))
        if ContentType.TAG in grouped:
            decisions.update(
                await resolve_tags(
                    self.session,
                    subject,
                    grouped[ContentType.TAG],
                )
            )
        if include_attachment_files and ContentType.FILE in grouped:
            await self._supplement_attachment_files(subject, decisions)
        return decisions

    async def _supplement_attachment_files(
        self,
        subject: AccessSubject,
        decisions: dict[ResourceKey, ResourceAccessDecision],
    ) -> None:
        denied_file_ids = {
            key.content_id
            for key, decision in decisions.items()
            if key.content_type == ContentType.FILE
            and decision.row_state == ResourceRowState.LIVE
            and not decision.can_view
        }
        if not denied_file_ids:
            return
        # An explicit BLOCKED grant on the file itself beats the
        # parent-derived read.
        denied_file_ids -= await self._blocked_file_ids(subject, denied_file_ids)
        if not denied_file_ids:
            return
        rows = (
            await self.session.execute(
                select(
                    Attachment.file_id,
                    Attachment.content_type,
                    Attachment.content_id,
                ).where(
                    Attachment.organization_id == subject.organization_id,
                    Attachment.file_id.in_(denied_file_ids),
                )
            )
        ).all()
        if not rows:
            return
        parent_keys = {ResourceKey(row.content_type, row.content_id) for row in rows}
        parent_decisions = await self._resolve_with_subject(
            subject,
            parent_keys,
            include_attachment_files=False,
        )
        for row in rows:
            parent = parent_decisions[ResourceKey(row.content_type, row.content_id)]
            if not parent.can_view:
                continue
            key = ResourceKey(ContentType.FILE, row.file_id)
            direct = decisions[key]
            decisions[key] = ResourceAccessDecision(
                key=key,
                row_state=direct.row_state,
                can_view=True,
                role=ContentRole.VIEWER,
                request_target=direct.request_target,
                target_policy=direct.target_policy,
            )

    async def _blocked_file_ids(
        self,
        subject: AccessSubject,
        file_ids: set[UUID],
    ) -> set[UUID]:
        subject_predicates = [
            and_(
                ContentMember.subject_type == SubjectType.USER,
                ContentMember.subject_id == subject.user_id,
            )
        ]
        if subject.group_ids:
            subject_predicates.append(
                and_(
                    ContentMember.subject_type == SubjectType.GROUP,
                    ContentMember.subject_id.in_(subject.group_ids),
                )
            )
        rows = (
            await self.session.execute(
                select(ContentMember.content_id).where(
                    ContentMember.organization_id == subject.organization_id,
                    ContentMember.content_type == ContentType.FILE,
                    ContentMember.content_id.in_(file_ids),
                    ContentMember.role == ContentRole.BLOCKED,
                    or_(
                        ContentMember.expires_at.is_(None),
                        ContentMember.expires_at > datetime.now(UTC),
                    ),
                    or_(*subject_predicates),
                )
            )
        ).all()
        return {row.content_id for row in rows}
