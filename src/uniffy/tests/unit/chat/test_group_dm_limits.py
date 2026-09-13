from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.types import generate_id
from uniffy.domains.chat.channels import direct as direct_module
from uniffy.domains.chat.channels import subjects as subjects_module
from uniffy.domains.chat.channels.limits import (
    GROUP_DM_CAP_MESSAGE,
    GROUP_DM_MAX_PARTICIPANTS,
)
from uniffy.domains.chat.channels.operations import ChatChannelOperations
from uniffy.domains.chat.subjects import ChatSubject


class PastTheCap(Exception):
    """Sentinel for the first step after the cap guard, proving the guard passed."""


def _operations() -> tuple[ChatChannelOperations, UUID, UUID]:
    operations = ChatChannelOperations.__new__(ChatChannelOperations)
    operations.session = MagicMock()
    operations.session.execute = AsyncMock()
    operations.access = MagicMock()
    operations.access.require_org_member = AsyncMock()
    operations._require_active_user_subjects = AsyncMock()
    return operations, generate_id(), generate_id()


def _group_dm(organization_id: UUID) -> ChatChannel:
    return ChatChannel(
        organization_id=organization_id,
        owner_id=generate_id(),
        name="group",
        slug="group",
        channel_type=ChannelType.GROUP_DM,
    )


async def test_create_dm_accepts_the_cap() -> None:
    operations, user_id, organization_id = _operations()
    operations._build_dm_name = AsyncMock(return_value="group")
    operations.create_channel = AsyncMock(return_value="created")
    targets = [generate_id() for _ in range(GROUP_DM_MAX_PARTICIPANTS - 1)]

    assert await operations.create_dm(user_id, organization_id, targets) == "created"
    assert operations.create_channel.await_args.kwargs["channel_type"] == ChannelType.GROUP_DM


async def test_create_dm_rejects_one_past_the_cap() -> None:
    operations, user_id, organization_id = _operations()
    operations.create_channel = AsyncMock()
    targets = [generate_id() for _ in range(GROUP_DM_MAX_PARTICIPANTS)]

    with pytest.raises(ValidationError) as err:
        await operations.create_dm(user_id, organization_id, targets)

    assert err.value.message == GROUP_DM_CAP_MESSAGE
    operations.create_channel.assert_not_awaited()


async def test_create_dm_with_subjects_accepts_the_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    operations, user_id, organization_id = _operations()
    monkeypatch.setattr(
        direct_module,
        "check_chat_mutation_limit",
        AsyncMock(side_effect=PastTheCap()),
    )
    subjects = [ChatSubject.user(generate_id()) for _ in range(GROUP_DM_MAX_PARTICIPANTS - 1)]

    with pytest.raises(PastTheCap):
        await operations.create_dm_with_subjects(user_id, organization_id, subjects)


async def test_create_dm_with_subjects_rejects_one_past_the_cap() -> None:
    operations, user_id, organization_id = _operations()
    subjects = [ChatSubject.user(generate_id()) for _ in range(GROUP_DM_MAX_PARTICIPANTS)]

    with pytest.raises(ValidationError) as err:
        await operations.create_dm_with_subjects(user_id, organization_id, subjects)

    assert err.value.message == GROUP_DM_CAP_MESSAGE


async def test_add_members_accepts_filling_the_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    operations, user_id, organization_id = _operations()
    channel = _group_dm(organization_id)
    operations.get_by_id = AsyncMock(return_value=channel)
    operations.access.get_membership = AsyncMock(return_value=MagicMock())
    operations.session.execute = AsyncMock(
        return_value=MagicMock(scalar_one=MagicMock(return_value=GROUP_DM_MAX_PARTICIPANTS - 1))
    )
    monkeypatch.setattr(
        subjects_module,
        "check_chat_mutation_limit",
        AsyncMock(side_effect=PastTheCap()),
    )

    with pytest.raises(PastTheCap):
        await operations.add_members_with_subjects(
            user_id,
            organization_id,
            channel.id,
            [ChatSubject.user(generate_id())],
        )


async def test_add_members_rejects_one_past_the_cap() -> None:
    operations, user_id, organization_id = _operations()
    channel = _group_dm(organization_id)
    operations.get_by_id = AsyncMock(return_value=channel)
    operations.access.get_membership = AsyncMock(return_value=MagicMock())
    operations.session.execute = AsyncMock(
        return_value=MagicMock(scalar_one=MagicMock(return_value=GROUP_DM_MAX_PARTICIPANTS))
    )

    with pytest.raises(ValidationError) as err:
        await operations.add_members_with_subjects(
            user_id,
            organization_id,
            channel.id,
            [ChatSubject.user(generate_id())],
        )

    assert err.value.message == GROUP_DM_CAP_MESSAGE


async def test_one_to_one_dm_stays_below_the_group_split() -> None:
    operations, user_id, organization_id = _operations()
    operations._find_existing_dm = AsyncMock(return_value=None)
    operations._build_dm_name = AsyncMock(return_value="dm")
    operations.create_channel = AsyncMock(return_value="created")

    await operations.create_dm(user_id, organization_id, [generate_id()])

    assert operations.create_channel.await_args.kwargs["channel_type"] == ChannelType.DIRECT
