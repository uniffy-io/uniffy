"""The JIT door: the exact functions a SCIM push endpoint or OIDC callback calls."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.login.user import User
from uniffy.core.models.people.identity import IdentitySource, IdentitySourceKind
from uniffy.core.types import generate_id
from uniffy.domains.people.directory import reconcile
from uniffy.domains.people.directory.types import DirectoryUser


def _source() -> IdentitySource:
    return IdentitySource(organization_id=generate_id(), kind=IdentitySourceKind.OIDC, name="SSO")


def _record(**overrides) -> DirectoryUser:
    defaults = {
        "external_id": "sub-1",
        "user_name": "jane",
        "email": "jane@example.com",
        "display_name": "Jane Doe",
    }
    defaults.update(overrides)
    return DirectoryUser(**defaults)


def _session(execute_results):
    session = MagicMock()
    session.execute = AsyncMock(side_effect=list(execute_results))
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    return session


class TestFindLinkedUser:
    async def test_returns_linked_user(self) -> None:
        user = User(email="jane@example.com", username="jane")
        result = MagicMock()
        result.scalar_one_or_none = MagicMock(return_value=user)
        session = _session([result])
        found = await reconcile.find_linked_user(session, _source(), "sub-1")
        assert found is user

    async def test_returns_none_for_unknown_external_id(self) -> None:
        result = MagicMock()
        result.scalar_one_or_none = MagicMock(return_value=None)
        session = _session([result])
        assert await reconcile.find_linked_user(session, _source(), "missing") is None


class TestProvisionFromLogin:
    async def test_provisions_one_record_through_the_primitives(self) -> None:
        source = _source()
        user = User(email="jane@example.com", username="jane")
        load_result = MagicMock()
        load_result.scalar_one = MagicMock(return_value=user)
        session = _session([load_result])
        with (
            patch.object(reconcile, "upsert_user", AsyncMock(return_value=user.id)) as upsert,
            patch.object(reconcile, "invalidate_person", AsyncMock()) as invalidate,
            patch.object(reconcile, "sync_people_search", AsyncMock()) as search,
        ):
            provisioned = await reconcile.provision_from_login(session, source, _record())

        assert provisioned is user
        upsert.assert_awaited_once()
        session.commit.assert_awaited()
        invalidate.assert_awaited_once_with(source.organization_id, user.id)
        search.assert_awaited_once_with(session, source.organization_id, [user.id])

    async def test_unprovisionable_record_raises_typed_error(self) -> None:
        session = _session([])
        with (
            patch.object(reconcile, "upsert_user", AsyncMock(return_value=None)),
            pytest.raises(ValidationError, match="record"),
        ):
            await reconcile.provision_from_login(session, _source(), _record(active=False))
