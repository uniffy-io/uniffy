"""Org creation seeds the LOCAL identity source in the org's first transaction."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.people.identity import IdentitySource, IdentitySourceKind
from uniffy.core.types import generate_id
from uniffy.domains.organizations.operations import OrganizationOperations


class _FirstCommit(Exception):
    """Raised by the mocked first commit so the test sees exactly the rows
    staged in the org's initial transaction and nothing later."""


class TestOrgCreateSeedsLocalSource:
    async def test_local_source_staged_before_first_commit(self) -> None:
        session = MagicMock()
        session.add = MagicMock()
        session.flush = AsyncMock()
        session.commit = AsyncMock(side_effect=_FirstCommit)
        ops = OrganizationOperations(session)

        with pytest.raises(_FirstCommit):
            await ops.create("Acme", "acme", generate_id())

        added = [call.args[0] for call in session.add.call_args_list]
        sources = [row for row in added if isinstance(row, IdentitySource)]
        memberships = [row for row in added if isinstance(row, OrganizationMember)]
        assert len(sources) == 1
        assert sources[0].kind is IdentitySourceKind.LOCAL
        assert sources[0].is_active is True
        assert len(memberships) == 1
        assert sources[0].organization_id == memberships[0].organization_id
