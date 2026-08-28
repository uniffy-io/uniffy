"""Calendar operations."""

from uuid import UUID

from loguru import logger

from uniffy.core.auth.membership import get_active_membership
from uniffy.core.errors import (
    ValidationError,
)
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.login.organization_member import (
    OrganizationRole,
)

logger = logger.bind(component="calendar.events.channels")


class ChannelBindingOperations:
    def __init__(self, events: object) -> None:
        self.events = events
        self.session = events.session

    async def _is_org_admin(self, user_id: UUID, organization_id: UUID) -> bool:
        membership = await get_active_membership(self.session, user_id, organization_id)
        return membership is not None and membership.role in (
            OrganizationRole.OWNER,
            OrganizationRole.ADMIN,
        )

    async def _validate_channel_binding(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
    ) -> None:
        """Verify the organizer may bind an event to ``channel_id``.

        ``get_channel`` already scopes to the org and rejects deleted channels;
        this additionally rejects archived channels and requires the caller to
        pass the chat access check. Join stays gated per user at call time, so
        no attendee membership is inspected here.
        """
        from uniffy.domains.chat.access import ChatAccessChecker

        checker = ChatAccessChecker(self.session)
        channel = await checker.get_channel(channel_id, organization_id)
        if channel.is_archived:
            raise ValidationError("channel_id", "Channel is archived.")
        await checker.check_access(user_id, organization_id, channel)

    async def _apply_channel_binding_update(
        self,
        user_id: UUID,
        organization_id: UUID,
        event: CalendarEvent,
        channel_id: str | None,
        meeting_url_provided: bool,
        channel_auto_created: bool = False,
    ) -> None:
        """Apply a channel binding change on update and enforce mutual exclusion.

        ``channel_id`` unset leaves the binding untouched, empty string clears
        it, and a uuid string binds after validation. An event is either a link
        meeting or a channel meeting, never both.
        """
        if channel_id is not None:
            if channel_id == "":
                event.channel_id = None
                event.channel_auto_created = False
            else:
                new_channel_id = UUID(channel_id)
                await self.events._validate_channel_binding(user_id, organization_id, new_channel_id)
                if event.channel_id != new_channel_id:
                    # A new binding takes the caller's flag: True for a room the
                    # editor auto-created, False for a picked channel.
                    event.channel_auto_created = channel_auto_created
                event.channel_id = new_channel_id
        if (meeting_url_provided or channel_id is not None) and (
            event.channel_id is not None and event.meeting_url
        ):
            raise ValidationError(
                "channel_id",
                "An event cannot have both a meeting URL and a channel binding.",
            )
