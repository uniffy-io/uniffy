"""Edit window policy enforcement and message edit-history access."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Pre-import the auth package (full chain) so its handlers module
# finishes before any other test-file import triggers a partial-init
# cycle through core.converters.
import uniffy.domains.auth  # noqa: F401
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.chat.message_revision import ChatMessageRevision
from uniffy.core.types import generate_id
from uniffy.domains.chat.messages.operations import ChatMessageAction, ChatMessageOperations
from uniffy.domains.chat.policy import EditHistoryVisibility, ResolvedChatPolicy

ORG = generate_id()
CHANNEL_ID = generate_id()
SENDER = generate_id()
OTHER = generate_id()


def _policy(**overrides) -> ResolvedChatPolicy:
    return ResolvedChatPolicy(organization_id=ORG, **overrides)


def _patch_policy(policy: ResolvedChatPolicy):
    # Bound at import in operations, so the patch targets the consumer module.
    return patch(
        "uniffy.domains.chat.messages.operations.resolve_chat_policy",
        AsyncMock(return_value=policy),
    )


def _message(
    age_minutes: int = 0,
    *,
    sender_id=SENDER,
    channel_id=CHANNEL_ID,
    is_deleted: bool = False,
) -> ChatMessage:
    return ChatMessage(
        id=generate_id(),
        channel_id=channel_id,
        sender_id=sender_id,
        sender_type=SenderType.USER,
        content="original",
        created_at=datetime.now(UTC) - timedelta(minutes=age_minutes),
        is_deleted=is_deleted,
    )


def _scalars(rows: list):
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    return result


def _scalar_one(value):
    result = MagicMock()
    result.scalar_one.return_value = value
    return result


def _make_ops(*, elevated: bool = False, execute_results: list | None = None):
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    results = list(execute_results or [])

    async def fake_execute(stmt):
        if results:
            return results.pop(0)
        return _scalars([])

    session.execute = fake_execute

    access = MagicMock()
    access.get_channel = AsyncMock(return_value=MagicMock(id=CHANNEL_ID))
    access.check_access = AsyncMock()
    access.require_elevated = AsyncMock(return_value=elevated)
    access.get_membership = AsyncMock(return_value=MagicMock())
    return ChatMessageOperations(session, access), session


class TestEditWindowGate:
    async def test_edit_within_default_window_passes(self):
        ops, _ = _make_ops()
        with _patch_policy(_policy()):
            await ops._require_message_action(
                SENDER, ORG, CHANNEL_ID, _message(age_minutes=59), ChatMessageAction.EDIT
            )

    async def test_edit_past_window_rejected(self):
        ops, _ = _make_ops()
        with _patch_policy(_policy(edit_window_minutes=15)):
            with pytest.raises(ValidationError):
                await ops._require_message_action(
                    SENDER, ORG, CHANNEL_ID, _message(age_minutes=16), ChatMessageAction.EDIT
                )

    async def test_zero_window_disables_editing(self):
        ops, _ = _make_ops()
        with _patch_policy(_policy(edit_window_minutes=0)):
            with pytest.raises(PermissionDeniedError):
                await ops._require_message_action(
                    SENDER, ORG, CHANNEL_ID, _message(age_minutes=0), ChatMessageAction.EDIT
                )

    async def test_unlimited_window_allows_old_messages(self):
        ops, _ = _make_ops()
        with _patch_policy(_policy(edit_window_minutes=None)):
            await ops._require_message_action(
                SENDER, ORG, CHANNEL_ID, _message(age_minutes=60 * 24 * 30), ChatMessageAction.EDIT
            )

    async def test_only_the_sender_may_edit(self):
        ops, _ = _make_ops(elevated=True)
        with _patch_policy(_policy(edit_window_minutes=None)):
            with pytest.raises(PermissionDeniedError):
                await ops._require_message_action(
                    OTHER, ORG, CHANNEL_ID, _message(), ChatMessageAction.EDIT
                )


class TestRecordRevision:
    async def test_first_revision_snapshots_prior_content(self):
        ops, session = _make_ops(execute_results=[_scalar_one(0)])
        msg = _message()
        await ops._record_revision(msg, edited_by=SENDER)

        session.add.assert_called_once()
        revision = session.add.call_args.args[0]
        assert isinstance(revision, ChatMessageRevision)
        assert revision.message_id == msg.id
        assert revision.revision_no == 1
        assert revision.content == "original"
        assert revision.edited_by == SENDER

    async def test_revision_number_increments(self):
        ops, session = _make_ops(execute_results=[_scalar_one(2)])
        await ops._record_revision(_message(), edited_by=SENDER)
        assert session.add.call_args.args[0].revision_no == 3


class TestUpdateMessageRevisions:
    async def test_unchanged_content_writes_nothing(self):
        ops, session = _make_ops()
        msg = _message()
        ops._get_message_by_id = AsyncMock(return_value=msg)

        with _patch_policy(_policy()):
            result = await ops.update_message(SENDER, ORG, CHANNEL_ID, msg.id, "original")

        assert result is msg
        session.add.assert_not_called()
        session.commit.assert_not_awaited()


class TestGetMessageRevisions:
    def _revision(self, no: int) -> ChatMessageRevision:
        return ChatMessageRevision(
            message_id=CHANNEL_ID, revision_no=no, content=f"rev {no}", edited_by=SENDER
        )

    async def test_sender_reads_own_history(self):
        rows = [self._revision(1), self._revision(2)]
        ops, _ = _make_ops(execute_results=[_scalars(rows)])
        ops._get_message_by_id = AsyncMock(return_value=_message())

        revisions = await ops.get_message_revisions(SENDER, ORG, CHANNEL_ID, generate_id())
        assert [r.revision_no for r in revisions] == [1, 2]

    async def test_non_sender_denied_under_admins_policy(self):
        ops, _ = _make_ops(elevated=False)
        ops._get_message_by_id = AsyncMock(return_value=_message())

        with _patch_policy(_policy(edit_history_visible_to=EditHistoryVisibility.ADMINS)):
            with pytest.raises(PermissionDeniedError):
                await ops.get_message_revisions(OTHER, ORG, CHANNEL_ID, generate_id())

    async def test_elevated_viewer_allowed_under_admins_policy(self):
        ops, _ = _make_ops(elevated=True, execute_results=[_scalars([self._revision(1)])])
        ops._get_message_by_id = AsyncMock(return_value=_message())

        with _patch_policy(_policy(edit_history_visible_to=EditHistoryVisibility.ADMINS)):
            revisions = await ops.get_message_revisions(OTHER, ORG, CHANNEL_ID, generate_id())
        assert len(revisions) == 1

    async def test_everyone_policy_opens_history_to_members(self):
        ops, _ = _make_ops(elevated=False, execute_results=[_scalars([self._revision(1)])])
        ops._get_message_by_id = AsyncMock(return_value=_message())

        with _patch_policy(_policy(edit_history_visible_to=EditHistoryVisibility.EVERYONE)):
            revisions = await ops.get_message_revisions(OTHER, ORG, CHANNEL_ID, generate_id())
        assert len(revisions) == 1

    async def test_deleted_message_is_not_found(self):
        ops, _ = _make_ops()
        ops._get_message_by_id = AsyncMock(return_value=_message(is_deleted=True))

        with pytest.raises(NotFoundError):
            await ops.get_message_revisions(SENDER, ORG, CHANNEL_ID, generate_id())

    async def test_message_from_another_channel_is_not_found(self):
        ops, _ = _make_ops()
        ops._get_message_by_id = AsyncMock(return_value=_message(channel_id=generate_id()))

        with pytest.raises(NotFoundError):
            await ops.get_message_revisions(SENDER, ORG, CHANNEL_ID, generate_id())
