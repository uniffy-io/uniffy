"""Resolve requested URNs to the content whose access policy can be changed."""

from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.membership import is_active_member
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.roles import role_can_manage, role_can_view
from uniffy.core.content.members import get_content_loader
from uniffy.core.content.references import parse_urn
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.permissions.content_access_request import ContentAccessRequest
from uniffy.core.models.projects.task import Task
from uniffy.core.types import ContentType
from uniffy.domains.chat.access import ChatAccessChecker


class AccessGrantKind(StrEnum):
    STANDARD = "STANDARD"
    CHAT = "CHAT"


@dataclass(frozen=True)
class AccessRequestTarget:
    requested_urn: str
    original_content_type: ContentType
    original_content_id: UUID
    canonical_content_type: ContentType
    canonical_content_id: UUID
    grant_kind: AccessGrantKind
    canonical_row: object


_DIRECT_TARGETS = frozenset({
    ContentType.NOTE,
    ContentType.FILE,
    ContentType.FOLDER,
    ContentType.CALENDAR_EVENT,
    ContentType.PROJECT,
    ContentType.AGENT,
    ContentType.ROOM,
})


class AccessRequestTargetResolver:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def require_active_member(self, user_id: UUID, organization_id: UUID) -> None:
        if not await is_active_member(user_id, organization_id, session=self.session):
            raise PermissionDeniedError("access", "organization")

    async def resolve(self, organization_id: UUID, requested_urn: str) -> AccessRequestTarget:
        parsed = parse_urn(requested_urn)
        if parsed is None:
            raise ValidationError("requested_urn", "Invalid content URN")

        content_type, content_id = parsed
        if content_type in _DIRECT_TARGETS:
            return await self._resolve_direct(
                organization_id,
                requested_urn,
                content_type,
                content_id,
            )
        if content_type == ContentType.TASK:
            return await self._resolve_task(organization_id, requested_urn, content_id)
        if content_type == ContentType.CHAT:
            return await self._resolve_channel(organization_id, requested_urn, content_id)
        if content_type == ContentType.CHAT_MESSAGE:
            return await self._resolve_message(organization_id, requested_urn, content_id)
        raise ValidationError("requested_urn", "This content type does not support access requests")

    async def requester_has_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        target: AccessRequestTarget,
    ) -> bool:
        if target.grant_kind == AccessGrantKind.CHAT:
            checker = ChatAccessChecker(self.session)
            try:
                await checker.check_access(user_id, organization_id, target.canonical_row)
            except PermissionDeniedError:
                return False
            return True

        row = target.canonical_row
        role = await PermissionChecker(self.session).effective_role(
            user_id=user_id,
            organization_id=organization_id,
            content_type=target.canonical_content_type,
            content_id=target.canonical_content_id,
            owner_id=row.owner_id,
            access_mode=row.access_mode,
            baseline_role=row.baseline_role,
        )
        return role_can_view(role)

    async def resolve_request(
        self,
        request: ContentAccessRequest,
    ) -> AccessRequestTarget:
        if request.canonical_content_type == ContentType.CHAT:
            channel = await self._private_channel(
                request.organization_id,
                request.canonical_content_id,
            )
            return AccessRequestTarget(
                requested_urn=request.requested_urn,
                original_content_type=request.original_content_type,
                original_content_id=request.original_content_id,
                canonical_content_type=ContentType.CHAT,
                canonical_content_id=request.canonical_content_id,
                grant_kind=AccessGrantKind.CHAT,
                canonical_row=channel,
            )
        if request.canonical_content_type not in _DIRECT_TARGETS:
            raise ValidationError("canonical_target", "Invalid stored access target")
        row = await get_content_loader(request.canonical_content_type)(
            self.session,
            request.organization_id,
            request.canonical_content_id,
        )
        if row is None or getattr(row, "is_deleted", False):
            raise NotFoundError(
                request.canonical_content_type.value.lower(),
                request.canonical_content_id,
            )
        return AccessRequestTarget(
            requested_urn=request.requested_urn,
            original_content_type=request.original_content_type,
            original_content_id=request.original_content_id,
            canonical_content_type=request.canonical_content_type,
            canonical_content_id=request.canonical_content_id,
            grant_kind=AccessGrantKind.STANDARD,
            canonical_row=row,
        )

    async def reviewer_can_manage(
        self,
        user_id: UUID,
        organization_id: UUID,
        target: AccessRequestTarget,
    ) -> bool:
        if target.grant_kind == AccessGrantKind.CHAT:
            return await ChatAccessChecker(self.session).require_elevated(
                user_id,
                organization_id,
                target.canonical_content_id,
            )

        row = target.canonical_row
        role = await PermissionChecker(self.session).effective_role(
            user_id=user_id,
            organization_id=organization_id,
            content_type=target.canonical_content_type,
            content_id=target.canonical_content_id,
            owner_id=row.owner_id,
            access_mode=row.access_mode,
            baseline_role=row.baseline_role,
        )
        return role_can_manage(role)

    async def canonical_keys_for_urns(
        self,
        organization_id: UUID,
        requested_urns: list[str],
    ) -> dict[str, tuple[ContentType, UUID]]:
        parsed = {urn: value for urn in requested_urns if (value := parse_urn(urn)) is not None}
        keys: dict[str, tuple[ContentType, UUID]] = {}

        task_ids = {
            content_id
            for content_type, content_id in parsed.values()
            if content_type == ContentType.TASK
        }
        task_projects: dict[UUID, UUID] = {}
        if task_ids:
            rows = (
                await self.session.execute(
                    select(Task.id, Task.project_id).where(
                        Task.organization_id == organization_id,
                        Task.id.in_(task_ids),
                    )
                )
            ).all()
            task_projects = dict(rows)

        message_ids = {
            content_id
            for content_type, content_id in parsed.values()
            if content_type == ContentType.CHAT_MESSAGE
        }
        message_channels: dict[UUID, UUID] = {}
        if message_ids:
            rows = (
                await self.session.execute(
                    select(ChatMessage.id, ChatMessage.channel_id)
                    .join(ChatChannel, ChatChannel.id == ChatMessage.channel_id)
                    .where(
                        ChatMessage.id.in_(message_ids),
                        ChatChannel.organization_id == organization_id,
                    )
                )
            ).all()
            message_channels = dict(rows)

        for urn, (content_type, content_id) in parsed.items():
            if content_type in _DIRECT_TARGETS:
                keys[urn] = (content_type, content_id)
            elif content_type == ContentType.TASK and content_id in task_projects:
                keys[urn] = (ContentType.PROJECT, task_projects[content_id])
            elif content_type == ContentType.CHAT:
                keys[urn] = (ContentType.CHAT, content_id)
            elif content_type == ContentType.CHAT_MESSAGE and content_id in message_channels:
                keys[urn] = (ContentType.CHAT, message_channels[content_id])
        return keys

    async def _resolve_direct(
        self,
        organization_id: UUID,
        requested_urn: str,
        content_type: ContentType,
        content_id: UUID,
    ) -> AccessRequestTarget:
        row = await get_content_loader(content_type)(self.session, organization_id, content_id)
        if row is None or getattr(row, "is_deleted", False):
            raise NotFoundError(content_type.value.lower(), content_id)
        return AccessRequestTarget(
            requested_urn=requested_urn,
            original_content_type=content_type,
            original_content_id=content_id,
            canonical_content_type=content_type,
            canonical_content_id=content_id,
            grant_kind=AccessGrantKind.STANDARD,
            canonical_row=row,
        )

    async def _resolve_task(
        self,
        organization_id: UUID,
        requested_urn: str,
        task_id: UUID,
    ) -> AccessRequestTarget:
        task = (
            await self.session.execute(
                select(Task).where(
                    Task.id == task_id,
                    Task.organization_id == organization_id,
                    Task.is_deleted == False,  # noqa: E712
                )
            )
        ).scalar_one_or_none()
        if task is None:
            raise NotFoundError("task", task_id)
        project = await get_content_loader(ContentType.PROJECT)(
            self.session,
            organization_id,
            task.project_id,
        )
        if project is None or getattr(project, "is_deleted", False):
            raise NotFoundError("project", task.project_id)
        return AccessRequestTarget(
            requested_urn=requested_urn,
            original_content_type=ContentType.TASK,
            original_content_id=task_id,
            canonical_content_type=ContentType.PROJECT,
            canonical_content_id=task.project_id,
            grant_kind=AccessGrantKind.STANDARD,
            canonical_row=project,
        )

    async def _resolve_channel(
        self,
        organization_id: UUID,
        requested_urn: str,
        channel_id: UUID,
    ) -> AccessRequestTarget:
        channel = await self._private_channel(organization_id, channel_id)
        return AccessRequestTarget(
            requested_urn=requested_urn,
            original_content_type=ContentType.CHAT,
            original_content_id=channel_id,
            canonical_content_type=ContentType.CHAT,
            canonical_content_id=channel_id,
            grant_kind=AccessGrantKind.CHAT,
            canonical_row=channel,
        )

    async def _resolve_message(
        self,
        organization_id: UUID,
        requested_urn: str,
        message_id: UUID,
    ) -> AccessRequestTarget:
        row = (
            await self.session.execute(
                select(ChatMessage, ChatChannel)
                .join(ChatChannel, ChatChannel.id == ChatMessage.channel_id)
                .where(
                    ChatMessage.id == message_id,
                    ChatMessage.is_deleted == False,  # noqa: E712
                    ChatChannel.organization_id == organization_id,
                    ChatChannel.is_deleted == False,  # noqa: E712
                )
            )
        ).one_or_none()
        if row is None:
            raise NotFoundError("chat_message", message_id)
        _, channel = row
        self._validate_private_channel(channel)
        return AccessRequestTarget(
            requested_urn=requested_urn,
            original_content_type=ContentType.CHAT_MESSAGE,
            original_content_id=message_id,
            canonical_content_type=ContentType.CHAT,
            canonical_content_id=channel.id,
            grant_kind=AccessGrantKind.CHAT,
            canonical_row=channel,
        )

    async def _private_channel(
        self,
        organization_id: UUID,
        channel_id: UUID,
    ) -> ChatChannel:
        channel = (
            await self.session.execute(
                select(ChatChannel).where(
                    ChatChannel.id == channel_id,
                    ChatChannel.organization_id == organization_id,
                    ChatChannel.is_deleted == False,  # noqa: E712
                )
            )
        ).scalar_one_or_none()
        if channel is None:
            raise NotFoundError("channel", channel_id)
        self._validate_private_channel(channel)
        return channel

    @staticmethod
    def _validate_private_channel(channel: ChatChannel) -> None:
        if channel.channel_type != ChannelType.PRIVATE or channel.is_agent_dm:
            raise ValidationError(
                "requested_urn",
                "Only private channels support access requests",
            )
