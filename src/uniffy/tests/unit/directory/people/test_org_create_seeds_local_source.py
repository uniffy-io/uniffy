"""Organization staging includes the local identity source."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.people.identity import IdentitySource, IdentitySourceKind
from uniffy.core.types import generate_id
from uniffy.domains.organizations.operations import OrganizationOperations


class TestOrgCreateSeedsLocalSource:
    async def test_local_source_staged_with_owner_membership(self) -> None:
        session = MagicMock()
        session.add = MagicMock()
        session.add_all = MagicMock()
        session.flush = AsyncMock()
        owner_id = generate_id()
        owner_lookup = MagicMock()
        owner_lookup.scalar_one_or_none.return_value = SimpleNamespace(id=owner_id)
        session.execute = AsyncMock(return_value=owner_lookup)
        ops = OrganizationOperations.__new__(OrganizationOperations)
        ops._session = session

        cipher = MagicMock()
        cipher.provision = AsyncMock()
        channels = MagicMock()
        channels.stage_channel = AsyncMock(return_value=MagicMock())

        with (
            patch("uniffy.domains.organizations.operations.OrgCipher", return_value=cipher),
            patch(
                "uniffy.domains.organizations.operations.stage_personal_attachments_folder",
                AsyncMock(),
            ),
            patch(
                "uniffy.domains.organizations.operations.create_default_presets",
                AsyncMock(),
            ),
            patch(
                "uniffy.domains.organizations.operations.create_default_tag_filter_presets",
                AsyncMock(),
            ),
            patch(
                "uniffy.domains.organizations.operations.ChatChannelOperations",
                return_value=channels,
            ),
            patch(
                "uniffy.domains.organizations.operations.stage_default_agent",
                AsyncMock(return_value=MagicMock()),
            ),
            patch(
                "uniffy.domains.organizations.operations.write_audit_event",
                AsyncMock(),
            ),
        ):
            await ops.stage_organization("Acme", "acme", owner_id)

        added = [row for call in session.add_all.call_args_list for row in call.args[0]]
        sources = [row for row in added if isinstance(row, IdentitySource)]
        memberships = [row for row in added if isinstance(row, OrganizationMember)]
        assert len(sources) == 1
        assert sources[0].kind is IdentitySourceKind.LOCAL
        assert sources[0].is_active is True
        assert len(memberships) == 1
        assert sources[0].organization_id == memberships[0].organization_id
