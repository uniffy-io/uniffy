"""ListCollaborators and RecordPeoplePicks only ever act for the signed-in member."""

from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.people.v1 import people_pb as pb

from uniffy.core.auth.principal import (
    AuthenticatedPrincipal,
    reset_current_principal,
    set_current_principal,
)
from uniffy.core.errors import MembershipRequiredError, RateLimitExceededError
from uniffy.core.types import generate_id
from uniffy.domains.directory.people.service import PeopleServiceImpl

_RPC = "uniffy.domains.directory.people.rpc.collaborators"


@contextmanager
def _signed_in(user_id: UUID, organization_id: UUID) -> Iterator[None]:
    token = set_current_principal(
        AuthenticatedPrincipal(
            user_id=user_id,
            organization_id=organization_id,
            session_id=None,
            token_version=None,
            full_name="",
            avatar_key="",
        )
    )
    try:
        yield
    finally:
        reset_current_principal(token)


@asynccontextmanager
async def _fake_session() -> AsyncIterator[MagicMock]:
    session = MagicMock()
    session.commit = AsyncMock()
    yield session


def _service() -> PeopleServiceImpl:
    return PeopleServiceImpl(MagicMock())


async def test_non_members_are_refused_before_any_ranking_is_read() -> None:
    user_id, org_id = generate_id(), generate_id()
    reader = MagicMock()
    reader.return_value.list = AsyncMock()
    with (
        _signed_in(user_id, org_id),
        patch(f"{_RPC}.open_session", _fake_session),
        patch(
            f"{_RPC}.OrganizationOperations.require_org_member",
            AsyncMock(side_effect=MembershipRequiredError("Requires organization membership")),
        ),
        patch(f"{_RPC}.CollaboratorReader", reader),
        pytest.raises(ConnectError) as refused,
    ):
        await _service().list_collaborators(
            pb.ListCollaboratorsRequest(organization_id=str(org_id)), MagicMock()
        )
    assert refused.value.code == Code.PERMISSION_DENIED
    reader.return_value.list.assert_not_called()


async def test_the_ranking_read_is_always_the_callers_own() -> None:
    user_id, org_id = generate_id(), generate_id()
    reader = MagicMock()
    reader.return_value.list = AsyncMock(return_value=[])
    with (
        _signed_in(user_id, org_id),
        patch(f"{_RPC}.open_session", _fake_session),
        patch(f"{_RPC}.OrganizationOperations.require_org_member", AsyncMock()),
        patch(f"{_RPC}.CollaboratorReader", reader),
    ):
        await _service().list_collaborators(
            pb.ListCollaboratorsRequest(
                organization_id=str(org_id),
                query="a",
                limit=500,
                exclude_user_ids=["not-a-uuid", str(generate_id())],
            ),
            MagicMock(),
        )
    args, kwargs = reader.return_value.list.call_args
    assert args == (org_id, user_id)
    assert kwargs["query"] == "a"
    assert len(kwargs["exclude_user_ids"]) == 1


async def test_picks_drop_the_caller_and_a_rate_limited_burst_quietly() -> None:
    user_id, org_id = generate_id(), generate_id()
    stage = AsyncMock(return_value=1)
    peer = generate_id()
    with (
        _signed_in(user_id, org_id),
        patch(f"{_RPC}.open_session", _fake_session),
        patch(f"{_RPC}.OrganizationOperations.require_org_member", AsyncMock()),
        patch(f"{_RPC}.check_rate_limit", AsyncMock()),
        patch(f"{_RPC}.stage_interactions", stage),
    ):
        await _service().record_people_picks(
            pb.RecordPeoplePicksRequest(
                organization_id=str(org_id), user_ids=[str(user_id), str(peer)]
            ),
            MagicMock(),
        )
    pairs = stage.call_args.args[2]
    assert [(a, b) for a, b, _ in pairs] == [(user_id, peer)]

    with (
        _signed_in(user_id, org_id),
        patch(f"{_RPC}.open_session", _fake_session),
        patch(f"{_RPC}.OrganizationOperations.require_org_member", AsyncMock()),
        patch(
            f"{_RPC}.check_rate_limit",
            AsyncMock(side_effect=RateLimitExceededError("people picks", 30, 60)),
        ),
        patch(f"{_RPC}.stage_interactions", stage),
    ):
        stage.reset_mock()
        await _service().record_people_picks(
            pb.RecordPeoplePicksRequest(organization_id=str(org_id), user_ids=[str(peer)]),
            MagicMock(),
        )
    stage.assert_not_called()
