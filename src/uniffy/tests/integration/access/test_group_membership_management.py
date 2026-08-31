import pytest
from sqlalchemy import update

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.login.group_member import GroupMember, GroupRole
from uniffy.domains.directory.groups.members import GroupMemberOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _make_group_admin(session, group_id, user_id) -> None:
    await session.execute(
        update(GroupMember)
        .where(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
        .values(role=GroupRole.ADMIN, is_active=True)
    )
    await session.commit()


async def test_plain_member_cannot_manage_group_membership(session, access) -> None:
    operations = GroupMemberOperations(session)
    with pytest.raises(PermissionDeniedError):
        await operations.add_member(
            access.access_group_id, access.org_id, access.member_id, access.peer_id
        )
    with pytest.raises(PermissionDeniedError):
        await operations.remove_member(
            access.access_group_id, access.org_id, access.peer_id, access.member_id
        )


async def test_group_admin_manages_only_their_own_group(session, access) -> None:
    await _make_group_admin(session, access.access_group_id, access.peer_id)
    operations = GroupMemberOperations(session)

    membership = await operations.add_member(
        access.access_group_id, access.org_id, access.member_id, access.peer_id
    )
    assert membership.role is GroupRole.MEMBER

    updated = await operations.update_member_role(
        access.access_group_id, access.org_id, access.member_id, GroupRole.ADMIN, access.peer_id
    )
    assert updated.role is GroupRole.ADMIN

    await operations.remove_member(
        access.access_group_id, access.org_id, access.member_id, access.peer_id
    )

    # The grant is scoped: the same actor holds no ADMIN row on the team.
    with pytest.raises(PermissionDeniedError):
        await operations.add_member(access.team_id, access.org_id, access.member_id, access.peer_id)


async def test_deactivated_group_admin_row_confers_nothing(session, access) -> None:
    await _make_group_admin(session, access.access_group_id, access.peer_id)
    await session.execute(
        update(GroupMember)
        .where(
            GroupMember.group_id == access.access_group_id,
            GroupMember.user_id == access.peer_id,
        )
        .values(is_active=False)
    )
    await session.commit()

    with pytest.raises(PermissionDeniedError):
        await GroupMemberOperations(session).add_member(
            access.access_group_id, access.org_id, access.member_id, access.peer_id
        )
