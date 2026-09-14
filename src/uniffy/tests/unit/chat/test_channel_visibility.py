"""Owner-only PUBLIC <-> PRIVATE conversion, and the search refresh it must schedule."""

from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.audit.actions import Action
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.search.engine import SearchDocumentsPage
from uniffy.core.search.workspace import WorkspaceSearch
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType, generate_id
from uniffy.domains.chat.channels import lifecycle as lifecycle_module
from uniffy.domains.chat.channels import updates as updates_module
from uniffy.domains.chat.channels.operations import ChatChannelOperations
from uniffy.domains.chat.jobs import jobs as jobs_module

COMPLETE = "complete"


def _channel(channel_type: ChannelType, *, is_default: bool = False) -> ChatChannel:
    channel = ChatChannel(
        organization_id=generate_id(),
        owner_id=generate_id(),
        name="design-review",
        slug="design-review",
        channel_type=channel_type,
    )
    channel.is_default = is_default
    return channel


def _member(channel: ChatChannel, user_id, role: ChannelRole) -> ChatChannelMember:
    return ChatChannelMember(
        channel_id=channel.id,
        subject_type=SubjectType.USER,
        subject_id=user_id,
        user_id=user_id,
        role=role,
    )


def _operations(
    channel: ChatChannel,
    *,
    role: ChannelRole | None,
) -> tuple[ChatChannelOperations, object]:
    user_id = generate_id()
    operations = ChatChannelOperations.__new__(ChatChannelOperations)
    operations.session = MagicMock()
    operations.session.commit = AsyncMock()
    operations.session.refresh = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = channel
    operations.session.execute = AsyncMock(return_value=result)
    operations.get_by_id = AsyncMock(return_value=channel)
    operations.access = MagicMock()
    operations.access.get_membership = AsyncMock(
        return_value=_member(channel, user_id, role) if role else None
    )
    operations._post_actor_system_message = AsyncMock()
    operations._refresh_channel_live_state = AsyncMock()
    operations._publish_channel_updated = AsyncMock()
    operations._claim_visibility_refresh = AsyncMock(return_value=True)
    return operations, user_id


@pytest.fixture(autouse=True)
def _isolate(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(updates_module, "invalidate_cached_member_ids", AsyncMock())
    monkeypatch.setattr(updates_module, "publish_dismissed_requests", AsyncMock())
    monkeypatch.setattr(updates_module, "stage_attachment_parent_policy", AsyncMock())
    monkeypatch.setattr(jobs_module, "refresh_attachment_parent_search", AsyncMock())


@pytest.fixture
def audit(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    recorder = AsyncMock()
    monkeypatch.setattr(updates_module, "write_audit_event", recorder)
    return recorder


@pytest.fixture
def record_refresh(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    recorder = AsyncMock()
    monkeypatch.setattr(updates_module, "record_chat_search_acl_refresh", recorder)
    return recorder


@pytest.fixture
def enqueue_refresh(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    recorder = AsyncMock()
    monkeypatch.setattr(updates_module, "enqueue_chat_search_acl_refresh", recorder)
    return recorder


@pytest.fixture
def dismiss(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    recorder = AsyncMock(return_value=[])
    monkeypatch.setattr(updates_module, "stage_dismiss_pending_requests", recorder)
    return recorder


class TestGate:
    async def test_owner_locks_a_public_channel_down(
        self, audit: AsyncMock, record_refresh: AsyncMock, enqueue_refresh: AsyncMock
    ) -> None:
        channel = _channel(ChannelType.PUBLIC)
        operations, user_id = _operations(channel, role=ChannelRole.OWNER)

        result = await operations.change_channel_visibility(
            user_id, channel.organization_id, channel.id, ChannelType.PRIVATE
        )

        assert result.channel_type == ChannelType.PRIVATE
        assert audit.await_args.kwargs["action"] == Action.CHAT_CHANNEL_VISIBILITY_CHANGED
        assert audit.await_args.kwargs["details"] == {"from": "PUBLIC", "to": "PRIVATE"}

    async def test_channel_admin_is_rejected(self) -> None:
        channel = _channel(ChannelType.PUBLIC)
        operations, user_id = _operations(channel, role=ChannelRole.ADMIN)

        with pytest.raises(PermissionDeniedError):
            await operations.change_channel_visibility(
                user_id, channel.organization_id, channel.id, ChannelType.PRIVATE
            )
        assert channel.channel_type == ChannelType.PUBLIC

    async def test_non_member_is_rejected(self) -> None:
        """An org admin reaches get_by_id through moderation but holds no membership."""
        channel = _channel(ChannelType.PUBLIC)
        operations, user_id = _operations(channel, role=None)

        with pytest.raises(PermissionDeniedError):
            await operations.change_channel_visibility(
                user_id, channel.organization_id, channel.id, ChannelType.PRIVATE
            )


class TestValidation:
    @pytest.mark.parametrize("channel_type", [ChannelType.DIRECT, ChannelType.GROUP_DM])
    async def test_dms_have_no_visibility_to_change(self, channel_type: ChannelType) -> None:
        channel = _channel(channel_type)
        operations, user_id = _operations(channel, role=ChannelRole.OWNER)

        with pytest.raises(ValidationError):
            await operations.change_channel_visibility(
                user_id, channel.organization_id, channel.id, ChannelType.PRIVATE
            )

    @pytest.mark.parametrize("target", [ChannelType.DIRECT, ChannelType.GROUP_DM])
    async def test_target_must_be_public_or_private(self, target: ChannelType) -> None:
        channel = _channel(ChannelType.PUBLIC)
        operations, user_id = _operations(channel, role=ChannelRole.OWNER)

        with pytest.raises(ValidationError):
            await operations.change_channel_visibility(
                user_id, channel.organization_id, channel.id, target
            )

    async def test_same_type_is_rejected(self) -> None:
        channel = _channel(ChannelType.PUBLIC)
        operations, user_id = _operations(channel, role=ChannelRole.OWNER)

        with pytest.raises(ValidationError):
            await operations.change_channel_visibility(
                user_id, channel.organization_id, channel.id, ChannelType.PUBLIC
            )

    async def test_default_channel_cannot_go_private(self) -> None:
        channel = _channel(ChannelType.PUBLIC, is_default=True)
        operations, user_id = _operations(channel, role=ChannelRole.OWNER)

        with pytest.raises(ValidationError):
            await operations.change_channel_visibility(
                user_id, channel.organization_id, channel.id, ChannelType.PRIVATE
            )


class TestSearchRefresh:
    async def test_lock_down_schedules_a_refresh(
        self, audit: AsyncMock, record_refresh: AsyncMock, enqueue_refresh: AsyncMock
    ) -> None:
        channel = _channel(ChannelType.PUBLIC)
        operations, user_id = _operations(channel, role=ChannelRole.OWNER)

        await operations.change_channel_visibility(
            user_id, channel.organization_id, channel.id, ChannelType.PRIVATE
        )

        # The durable row commits with the type change; the queue call follows it.
        record_refresh.assert_awaited_once()
        assert record_refresh.await_args.kwargs["channel_id"] == channel.id
        enqueue_refresh.assert_awaited_once_with(channel.id)

    async def test_open_up_also_schedules_a_refresh(
        self,
        audit: AsyncMock,
        record_refresh: AsyncMock,
        enqueue_refresh: AsyncMock,
        dismiss: AsyncMock,
    ) -> None:
        """The membership call sites skip PUBLIC channels; a flip must not."""
        channel = _channel(ChannelType.PRIVATE)
        operations, user_id = _operations(channel, role=ChannelRole.OWNER)

        await operations.change_channel_visibility(
            user_id, channel.organization_id, channel.id, ChannelType.PUBLIC
        )

        record_refresh.assert_awaited_once()
        enqueue_refresh.assert_awaited_once_with(channel.id)

    async def test_a_claimed_channel_records_but_does_not_enqueue(
        self, audit: AsyncMock, record_refresh: AsyncMock, enqueue_refresh: AsyncMock
    ) -> None:
        channel = _channel(ChannelType.PUBLIC)
        operations, user_id = _operations(channel, role=ChannelRole.OWNER)
        operations._claim_visibility_refresh = AsyncMock(return_value=False)

        await operations.change_channel_visibility(
            user_id, channel.organization_id, channel.id, ChannelType.PRIVATE
        )

        # The row still lands, so the flush schedule carries the suppressed refresh.
        record_refresh.assert_awaited_once()
        enqueue_refresh.assert_not_awaited()


class TestPendingAccessRequests:
    async def test_open_up_dismisses_pending_requests(
        self,
        audit: AsyncMock,
        record_refresh: AsyncMock,
        enqueue_refresh: AsyncMock,
        dismiss: AsyncMock,
    ) -> None:
        channel = _channel(ChannelType.PRIVATE)
        operations, user_id = _operations(channel, role=ChannelRole.OWNER)

        await operations.change_channel_visibility(
            user_id, channel.organization_id, channel.id, ChannelType.PUBLIC
        )

        assert dismiss.await_args.kwargs["content_type"] == ContentType.CHAT
        assert dismiss.await_args.kwargs["content_id"] == channel.id

    async def test_lock_down_leaves_requests_alone(
        self,
        audit: AsyncMock,
        record_refresh: AsyncMock,
        enqueue_refresh: AsyncMock,
        dismiss: AsyncMock,
    ) -> None:
        channel = _channel(ChannelType.PUBLIC)
        operations, user_id = _operations(channel, role=ChannelRole.OWNER)

        await operations.change_channel_visibility(
            user_id, channel.organization_id, channel.id, ChannelType.PRIVATE
        )

        dismiss.assert_not_awaited()


class TestRefreshJobDerivation:
    """The job reads the channel's live type rather than a snapshot on the row.

    A replay after a second flip then writes the current answer, and any doc that
    drifted is healed by the next refresh that happens to run.
    """

    @staticmethod
    def _session(channel_type: ChannelType | None, member_ids: list) -> MagicMock:
        session = MagicMock()
        session.commit = AsyncMock()
        session.rollback = AsyncMock()

        refresh_row = MagicMock(version=4, organization_id=generate_id())
        results = [
            MagicMock(scalar_one_or_none=MagicMock(return_value=refresh_row)),
            MagicMock(scalar_one_or_none=MagicMock(return_value=channel_type)),
            MagicMock(scalars=MagicMock(return_value=MagicMock(all=lambda: member_ids))),
            MagicMock(rowcount=1),
        ]
        session.execute = AsyncMock(side_effect=results)
        return session

    @staticmethod
    def _patched(monkeypatch: pytest.MonkeyPatch, session: MagicMock) -> None:
        @asynccontextmanager
        async def _open():
            yield session

        monkeypatch.setattr(jobs_module, "open_session", _open)

    async def test_public_channel_derives_open_to_org(self, monkeypatch: pytest.MonkeyPatch) -> None:
        session = self._session(ChannelType.PUBLIC, [generate_id()])
        self._patched(monkeypatch, session)
        search = MagicMock(update_chat_message_sharing=AsyncMock(return_value=7))

        result = await jobs_module._process_channel(generate_id(), search)

        assert result["status"] == COMPLETE
        sent = search.update_chat_message_sharing.await_args.kwargs
        assert sent["access_mode"] == AccessMode.OPEN_TO_ORG.value
        assert sent["baseline_role"] == ContentRole.VIEWER.value
        assert sent["shared_user_ids"] == []

    async def test_private_channel_derives_explicit_members(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        member = generate_id()
        session = self._session(ChannelType.PRIVATE, [member])
        self._patched(monkeypatch, session)
        search = MagicMock(update_chat_message_sharing=AsyncMock(return_value=7))

        await jobs_module._process_channel(generate_id(), search)

        sent = search.update_chat_message_sharing.await_args.kwargs
        assert sent["access_mode"] == AccessMode.EXPLICIT_MEMBERS.value
        assert sent["baseline_role"] is None
        assert sent["shared_user_ids"] == [member]

    async def test_deleted_channel_drops_the_row_instead_of_retrying_forever(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        session = self._session(None, [])
        self._patched(monkeypatch, session)
        search = MagicMock(update_chat_message_sharing=AsyncMock())

        result = await jobs_module._process_channel(generate_id(), search)

        assert result == {"status": "skipped", "reason": "channel_missing"}
        search.update_chat_message_sharing.assert_not_awaited()


class TestMessageDocPatch:
    """The partial documents WorkspaceSearch actually sends, per direction.

    A public-era doc grants on access_mode plus baseline_role regardless of
    shared_user_ids, so a lock-down that patched membership alone would leave
    every historical message readable org-wide.
    """

    @staticmethod
    def _search() -> tuple[WorkspaceSearch, MagicMock]:
        engine = MagicMock()
        # One page of historical docs, then an empty page to end the walk.
        engine.fetch_documents = AsyncMock(
            side_effect=[
                SearchDocumentsPage(documents=({"id": "doc-1"},)),
                SearchDocumentsPage(documents=()),
            ]
        )
        engine.patch_documents = AsyncMock()
        return WorkspaceSearch(engine), engine

    @staticmethod
    def _sent(engine: MagicMock) -> dict[str, Any]:
        return engine.patch_documents.await_args.args[0][0]

    async def test_lock_down_writes_explicit_members_and_clears_the_baseline(self) -> None:
        search, engine = self._search()
        member = generate_id()

        await search.update_chat_message_sharing(
            organization_id=generate_id(),
            channel_id=generate_id(),
            shared_user_ids=[member],
            access_mode=AccessMode.EXPLICIT_MEMBERS.value,
            baseline_role=None,
        )

        patch = self._sent(engine)
        assert patch["access_mode"] == AccessMode.EXPLICIT_MEMBERS.value
        # Written explicitly: an omitted key leaves OPEN_TO_ORG's VIEWER in place.
        assert patch["baseline_role"] is None
        assert patch["shared_user_ids"] == [str(member)]

    async def test_open_up_writes_open_to_org_with_a_viewer_baseline(self) -> None:
        search, engine = self._search()

        await search.update_chat_message_sharing(
            organization_id=generate_id(),
            channel_id=generate_id(),
            shared_user_ids=[],
            access_mode=AccessMode.OPEN_TO_ORG.value,
            baseline_role=ContentRole.VIEWER.value,
        )

        patch = self._sent(engine)
        assert patch["access_mode"] == AccessMode.OPEN_TO_ORG.value
        assert patch["baseline_role"] == ContentRole.VIEWER.value
        # The old roster must not linger on a doc that now grants org-wide.
        assert patch["shared_user_ids"] == []


class TestJoin:
    async def test_join_reads_the_type_under_the_shared_visibility_lock(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        channel = _channel(ChannelType.PRIVATE)
        operations = ChatChannelOperations.__new__(ChatChannelOperations)
        operations.session = MagicMock()
        operations.access = MagicMock()
        operations.access.require_org_member = AsyncMock()
        lock = AsyncMock(return_value=channel)
        monkeypatch.setattr(lifecycle_module, "lock_channel_visibility", lock)

        # The row the lock hands back is the one the gate reads, so a lock-down
        # that committed while the join waited is what denies it.
        with pytest.raises(PermissionDeniedError):
            await operations.join_channel(generate_id(), channel.organization_id, channel.id)

        assert lock.await_args.args[1:] == (channel.id, channel.organization_id)
        assert lock.await_args.kwargs == {"shared": True}

