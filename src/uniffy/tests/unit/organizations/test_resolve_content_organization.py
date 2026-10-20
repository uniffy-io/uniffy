"""The content-to-organization resolver probes only the caller's own active memberships."""

from collections.abc import AsyncIterator
from contextlib import AbstractContextManager, asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.common.v1.common_pb import OrganizationRole as ProtoOrganizationRole
from uniffy_proto.organizations.v1.organizations_pb import (
    ResolveContentOrganizationRequest,
    ResolveContentOrganizationResponse,
)

from uniffy.core.content.references import CONTENT_URN_PREFIX
from uniffy.core.models import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.types import ContentType, generate_id
from uniffy.domains.organizations.handlers import OrganizationsHandlers
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.organizations.resolve import resolve_content_organization
from uniffy.domains.permissions.access import (
    ResourceAccessDecision,
    ResourceKey,
    ResourceRowState,
)

_RESOLVE = "uniffy.domains.organizations.resolve"
_HANDLERS = "uniffy.domains.organizations.handlers"
_LOADERS = "uniffy.core.content.registry._content_loaders"


class _NoteLoader:
    def __init__(self, holder_org_id: UUID, note_id: UUID) -> None:
        self.holder_org_id = holder_org_id
        self.note_id = note_id
        self.probed: list[UUID] = []

    async def __call__(
        self,
        session: AsyncSession,
        organization_id: UUID,
        content_id: UUID,
    ) -> object | None:
        self.probed.append(organization_id)
        if organization_id == self.holder_org_id and content_id == self.note_id:
            return MagicMock()
        return None


def _urn(content_type: ContentType, content_id: UUID) -> str:
    return f"{CONTENT_URN_PREFIX}{content_type.value}:{content_id}"


def _org(name: str, *, suspended: bool = False) -> Organization:
    return Organization(
        id=generate_id(),
        name=name,
        slug=name.lower(),
        plan="free",
        is_suspended=suspended,
    )


def _membership(
    org: Organization,
    user_id: UUID,
    role: OrganizationRole = OrganizationRole.MEMBER,
) -> OrganizationMember:
    return OrganizationMember(user_id=user_id, organization_id=org.id, role=role)


def _decision(
    note_id: UUID,
    *,
    can_view: bool,
    row_state: ResourceRowState = ResourceRowState.LIVE,
) -> dict[ResourceKey, ResourceAccessDecision]:
    key = ResourceKey(ContentType.NOTE, note_id)
    return {key: ResourceAccessDecision(key=key, row_state=row_state, can_view=can_view)}


def _only_note_loader(loader: _NoteLoader) -> AbstractContextManager[object]:
    # Clearing keeps every other content type unregistered; the registry is restored on exit.
    return patch.dict(_LOADERS, {ContentType.NOTE: loader}, clear=True)


async def _resolve(
    loader: _NoteLoader,
    memberships: list[tuple[Organization, OrganizationMember]],
    decisions: dict[ResourceKey, ResourceAccessDecision],
    *,
    user_id: UUID,
    urn: str,
) -> tuple[tuple[Organization, OrganizationMember] | None, AsyncMock]:
    resolver = AsyncMock(return_value=decisions)
    with (
        _only_note_loader(loader),
        patch.object(
            OrganizationOperations,
            "get_user_organizations",
            AsyncMock(return_value=memberships),
        ),
        patch(f"{_RESOLVE}.ResourceAccessResolver") as resolver_class,
    ):
        resolver_class.return_value.resolve = resolver
        resolved = await resolve_content_organization(AsyncMock(), user_id, urn)
    return resolved, resolver


async def test_member_of_both_resolves_the_organization_holding_the_note() -> None:
    user_id, note_id = generate_id(), generate_id()
    acme, globex = _org("Acme"), _org("Globex")
    acme_membership = _membership(acme, user_id)
    globex_membership = _membership(globex, user_id, OrganizationRole.ADMIN)
    loader = _NoteLoader(globex.id, note_id)

    resolved, resolver = await _resolve(
        loader,
        [(acme, acme_membership), (globex, globex_membership)],
        _decision(note_id, can_view=True),
        user_id=user_id,
        urn=_urn(ContentType.NOTE, note_id),
    )

    assert resolved == (globex, globex_membership)
    assert loader.probed == [acme.id, globex.id]
    resolver.assert_awaited_once()
    assert resolver.await_args is not None
    assert resolver.await_args.kwargs["actor_id"] == user_id
    assert resolver.await_args.kwargs["organization_id"] == globex.id


async def test_note_in_an_organization_the_caller_does_not_belong_to_resolves_nothing() -> None:
    user_id, note_id = generate_id(), generate_id()
    acme, globex = _org("Acme"), _org("Globex")
    loader = _NoteLoader(globex.id, note_id)

    resolved, resolver = await _resolve(
        loader,
        [(acme, _membership(acme, user_id))],
        _decision(note_id, can_view=True),
        user_id=user_id,
        urn=_urn(ContentType.NOTE, note_id),
    )

    assert resolved is None
    assert loader.probed == [acme.id]
    resolver.assert_not_awaited()


@pytest.mark.parametrize(
    "row_state",
    [ResourceRowState.LIVE, ResourceRowState.DELETED],
)
async def test_note_the_caller_cannot_view_resolves_nothing(row_state: ResourceRowState) -> None:
    user_id, note_id = generate_id(), generate_id()
    acme, globex = _org("Acme"), _org("Globex")
    loader = _NoteLoader(globex.id, note_id)

    resolved, resolver = await _resolve(
        loader,
        [(acme, _membership(acme, user_id)), (globex, _membership(globex, user_id))],
        _decision(note_id, can_view=False, row_state=row_state),
        user_id=user_id,
        urn=_urn(ContentType.NOTE, note_id),
    )

    assert resolved is None
    resolver.assert_awaited_once()


async def test_suspended_organization_is_never_probed() -> None:
    user_id, note_id = generate_id(), generate_id()
    acme, globex = _org("Acme"), _org("Globex", suspended=True)
    loader = _NoteLoader(globex.id, note_id)

    resolved, resolver = await _resolve(
        loader,
        [(acme, _membership(acme, user_id)), (globex, _membership(globex, user_id))],
        _decision(note_id, can_view=True),
        user_id=user_id,
        urn=_urn(ContentType.NOTE, note_id),
    )

    assert resolved is None
    assert loader.probed == [acme.id]
    resolver.assert_not_awaited()


@pytest.mark.parametrize(
    "urn",
    [
        "",
        "not-a-urn",
        f"{CONTENT_URN_PREFIX}NOTE",
        f"{CONTENT_URN_PREFIX}NOTE:not-a-uuid",
        f"{CONTENT_URN_PREFIX}UNKNOWN_TYPE:{generate_id()}",
        _urn(ContentType.CHAT, generate_id()),
    ],
)
async def test_malformed_or_unsupported_urn_resolves_nothing(urn: str) -> None:
    user_id = generate_id()
    acme = _org("Acme")
    loader = _NoteLoader(acme.id, generate_id())
    memberships = AsyncMock(return_value=[(acme, _membership(acme, user_id))])

    with (
        _only_note_loader(loader),
        patch.object(OrganizationOperations, "get_user_organizations", memberships),
    ):
        resolved = await resolve_content_organization(AsyncMock(), user_id, urn)

    assert resolved is None
    memberships.assert_not_awaited()
    assert loader.probed == []


@asynccontextmanager
async def _fake_open_session() -> AsyncIterator[AsyncMock]:
    yield AsyncMock()


async def _call_handler(
    resolved: tuple[Organization, OrganizationMember] | Exception | None,
) -> ResolveContentOrganizationResponse:
    resolver = (
        AsyncMock(side_effect=resolved)
        if isinstance(resolved, Exception)
        else AsyncMock(return_value=resolved)
    )
    with (
        patch(f"{_HANDLERS}.current_user_id", return_value=generate_id()),
        patch(f"{_HANDLERS}.open_session", _fake_open_session),
        patch(f"{_HANDLERS}.resolve_content_organization", resolver),
    ):
        return await OrganizationsHandlers().resolve_content_organization(
            ResolveContentOrganizationRequest(urn=_urn(ContentType.NOTE, generate_id())),
            AsyncMock(),
        )


async def test_handler_answers_not_found_when_nothing_resolves() -> None:
    with pytest.raises(ConnectError) as exc_info:
        await _call_handler(None)

    assert exc_info.value.code is Code.NOT_FOUND
    assert exc_info.value.message == "Content not found"


async def test_handler_returns_the_organization_and_the_callers_role() -> None:
    globex = _org("Globex")
    membership = _membership(globex, generate_id(), OrganizationRole.ADMIN)

    response = await _call_handler((globex, membership))

    assert response.organization is not None
    assert response.organization.id == str(globex.id)
    assert response.organization.slug == "globex"
    assert response.role == ProtoOrganizationRole.ADMIN


async def test_handler_hides_unexpected_errors() -> None:
    with pytest.raises(ConnectError) as exc_info:
        await _call_handler(RuntimeError("database exploded"))

    assert exc_info.value.code is Code.INTERNAL
    assert exc_info.value.message == "Internal server error"
