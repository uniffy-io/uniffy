"""TEAM docs stay paired with mention fanout across every group mutation."""

from contextlib import nullcontext
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import AccessMode, ContentRole, generate_id
from uniffy.domains.groups.operations import GroupOperations
from uniffy.domains.groups.search import TeamSearchIndexer, build_team_urn

ORG = generate_id()
ACTOR = generate_id()


def _scalar_result(value=None):
    result = MagicMock()
    result.scalar = MagicMock(return_value=value)
    result.scalar_one_or_none = MagicMock(return_value=value)
    result.all = MagicMock(return_value=[])
    return result


def _rows_result(rows):
    result = MagicMock()
    result.all = MagicMock(return_value=rows)
    scalars = MagicMock()
    scalars.all = MagicMock(return_value=rows)
    result.scalars = MagicMock(return_value=scalars)
    return result


def _session(execute_results=None):
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.flush = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    if execute_results is None:
        session.execute = AsyncMock(return_value=_scalar_result())
    else:
        session.execute = AsyncMock(side_effect=execute_results)
    return session


def _search_indexer() -> SearchIndexer:
    return SearchIndexer(MagicMock())


def _group(**overrides) -> Group:
    defaults = dict(
        id=generate_id(),
        organization_id=ORG,
        name="Engineering",
        slug="engineering",
        created_by_user_id=ACTOR,
        kind=GroupKind.TEAM,
        is_private=False,
        managed_fields=[],
    )
    defaults.update(overrides)
    return Group(**defaults)


def _as_admin():
    row = OrganizationMember(
        user_id=ACTOR, organization_id=ORG, role=OrganizationRole.ADMIN, is_active=True
    )
    return patch(
        "uniffy.domains.organizations.operations.get_active_membership",
        AsyncMock(return_value=row),
    )


def _ops_patches():
    return (
        patch("uniffy.domains.groups.operations.write_audit_event", AsyncMock()),
        patch("uniffy.domains.groups.operations.invalidate_chart", AsyncMock()),
        patch("uniffy.domains.groups.operations.invalidate_org_people", AsyncMock()),
        patch("uniffy.domains.groups.operations.invalidate_person", AsyncMock()),
        nullcontext(),
        patch("uniffy.domains.groups.operations.ensure_name_available", AsyncMock()),
        patch(
            "uniffy.domains.groups.operations.resolve_slug",
            AsyncMock(return_value="slug"),
        ),
    )


class TestIndexTeam:
    async def test_team_doc_shape(self) -> None:
        parent_id = generate_id()
        group = _group(parent_group_id=parent_id, description="Ships the product")
        session = _session([_scalar_result(7), _scalar_result("Product")])
        index_mock = AsyncMock()
        publish_mock = AsyncMock()
        with (
            patch.object(SearchIndexer, "index", index_mock),
            patch("uniffy.domains.groups.search.publish_mention_state", publish_mock),
        ):
            await TeamSearchIndexer(session, _search_indexer()).index_team(group)

        kwargs = index_mock.call_args.kwargs
        assert kwargs["urn"] == f"urn:uniffy:content:TEAM:{group.id}"
        assert kwargs["entity_type"] == "team"
        assert kwargs["title"] == "Engineering"
        assert kwargs["url_path"] == f"/people?team={group.id}"
        assert kwargs["access_mode"] is AccessMode.OPEN_TO_ORG
        assert kwargs["baseline_role"] is ContentRole.VIEWER
        assert kwargs["owner_id"] == group.created_by_user_id
        assert kwargs["metadata"] == {"member_count": "7", "parent_label": "Product"}
        assert "Product" in kwargs["keywords"]

        changes = publish_mock.call_args.args[2]
        assert changes["title"] == "Engineering"
        assert changes["member_count"] == "7"
        assert changes["parent_label"] == "Product"

    async def test_parentless_team_publishes_empty_parent_label(self) -> None:
        group = _group()
        session = _session([_scalar_result(0)])
        publish_mock = AsyncMock()
        with (
            patch.object(SearchIndexer, "index", AsyncMock()) as index_mock,
            patch("uniffy.domains.groups.search.publish_mention_state", publish_mock),
        ):
            await TeamSearchIndexer(session, _search_indexer()).index_team(group)
        assert index_mock.call_args.kwargs["metadata"] == {"member_count": "0"}
        assert publish_mock.call_args.args[2]["parent_label"] == ""

    async def test_access_group_is_tombstoned_not_indexed(self) -> None:
        group = _group(kind=GroupKind.ACCESS)
        session = _session()
        index_mock = AsyncMock()
        remove_mock = AsyncMock()
        publish_mock = AsyncMock()
        with (
            patch.object(SearchIndexer, "index", index_mock),
            patch.object(SearchIndexer, "remove", remove_mock),
            patch("uniffy.domains.groups.search.publish_mention_state", publish_mock),
        ):
            await TeamSearchIndexer(session, _search_indexer()).index_team(group)
        index_mock.assert_not_awaited()
        remove_mock.assert_awaited_once_with(build_team_urn(group.id), ORG)
        assert publish_mock.call_args.args[2] == {"urn_status": "DELETED"}

    async def test_remove_team_pairs_tombstone_publish(self) -> None:
        group_id = generate_id()
        remove_mock = AsyncMock()
        publish_mock = AsyncMock()
        with (
            patch.object(SearchIndexer, "remove", remove_mock),
            patch("uniffy.domains.groups.search.publish_mention_state", publish_mock),
        ):
            await TeamSearchIndexer(_session(), _search_indexer()).remove_team(group_id, ORG)
        remove_mock.assert_awaited_once_with(build_team_urn(group_id), ORG)
        publish_mock.assert_awaited_once_with(
            ORG, build_team_urn(group_id), {"urn_status": "DELETED"}
        )

    async def test_sync_teams_reindexes_each_loaded_row(self) -> None:
        groups = [_group(), _group(name="Design", slug="design")]
        session = _session([_rows_result(groups)])
        with patch.object(TeamSearchIndexer, "index_team", AsyncMock()) as index_team:
            await TeamSearchIndexer(session, _search_indexer()).sync_teams(
                ORG, [g.id for g in groups]
            )
        assert index_team.await_count == 2

    async def test_sync_teams_empty_ids_is_a_noop(self) -> None:
        session = _session()
        await TeamSearchIndexer(session, _search_indexer()).sync_teams(ORG, [])
        session.execute.assert_not_awaited()


class TestGroupOperationsWiring:
    async def test_create_team_indexes(self) -> None:
        session = _session()
        ops = GroupOperations(session, _search_indexer())
        p = _ops_patches()
        with (
            _as_admin(),
            p[0],
            p[1],
            p[2],
            p[3],
            p[4],
            p[5],
            p[6],
            patch.object(TeamSearchIndexer, "index_team", AsyncMock()) as index_team,
        ):
            group = await ops.create(
                organization_id=ORG,
                name="Engineering",
                created_by_user_id=ACTOR,
                kind=GroupKind.TEAM,
            )
        index_team.assert_awaited_once_with(group)

    async def test_create_access_group_never_indexes(self) -> None:
        session = _session()
        ops = GroupOperations(session, _search_indexer())
        p = _ops_patches()
        with (
            _as_admin(),
            p[0],
            p[1],
            p[2],
            p[3],
            p[4],
            p[5],
            p[6],
            patch.object(TeamSearchIndexer, "index_team", AsyncMock()) as index_team,
        ):
            await ops.create(organization_id=ORG, name="Secret", created_by_user_id=ACTOR)
        index_team.assert_not_awaited()

    async def test_rename_reindexes_team_children_and_members(self) -> None:
        group = _group()
        child_ids = [generate_id()]
        member_ids = [generate_id(), generate_id()]
        session = _session()
        ops = GroupOperations(session, _search_indexer())
        p = _ops_patches()
        sync_people = AsyncMock()
        with (
            _as_admin(),
            p[0],
            p[1],
            p[2],
            p[3],
            p[4],
            p[5],
            p[6],
            patch("uniffy.domains.groups.operations.sync_people_search", sync_people),
            patch.object(GroupOperations, "_fetch", AsyncMock(return_value=group)),
            patch.object(GroupOperations, "_active_member_ids", AsyncMock(return_value=member_ids)),
            patch.object(TeamSearchIndexer, "index_team", AsyncMock()) as index_team,
            patch.object(TeamSearchIndexer, "child_team_ids", AsyncMock(return_value=child_ids)),
            patch.object(TeamSearchIndexer, "sync_teams", AsyncMock()) as sync_teams,
        ):
            await ops.update(
                group_id=group.id,
                organization_id=ORG,
                actor_user_id=ACTOR,
                name="Platform",
            )
        index_team.assert_awaited_once_with(group)
        sync_teams.assert_awaited_once_with(ORG, child_ids)
        sync_people.assert_awaited_once_with(session, ops.search_indexer, ORG, member_ids)

    async def test_description_change_reindexes_without_child_fanout(self) -> None:
        group = _group()
        session = _session()
        ops = GroupOperations(session, _search_indexer())
        p = _ops_patches()
        with (
            _as_admin(),
            p[0],
            p[1],
            p[2],
            p[3],
            p[4],
            p[5],
            p[6],
            patch("uniffy.domains.groups.operations.sync_people_search", AsyncMock()),
            patch.object(GroupOperations, "_fetch", AsyncMock(return_value=group)),
            patch.object(TeamSearchIndexer, "index_team", AsyncMock()) as index_team,
            patch.object(TeamSearchIndexer, "sync_teams", AsyncMock()) as sync_teams,
        ):
            await ops.update(
                group_id=group.id,
                organization_id=ORG,
                actor_user_id=ACTOR,
                description="New description",
            )
        index_team.assert_awaited_once_with(group)
        sync_teams.assert_not_awaited()

    async def test_demote_tombstones_and_resyncs_detached_children(self) -> None:
        group = _group()
        detached = [generate_id(), generate_id()]
        session = _session()
        ops = GroupOperations(session, _search_indexer())
        p = _ops_patches()
        with (
            _as_admin(),
            p[0],
            p[1],
            p[2],
            p[3],
            p[4],
            p[5],
            p[6],
            patch("uniffy.domains.groups.operations.sync_people_search", AsyncMock()),
            patch.object(GroupOperations, "_fetch", AsyncMock(return_value=group)),
            patch.object(GroupOperations, "_active_member_ids", AsyncMock(return_value=[])),
            patch.object(TeamSearchIndexer, "index_team", AsyncMock()) as index_team,
            patch.object(TeamSearchIndexer, "child_team_ids", AsyncMock(return_value=detached)),
            patch.object(TeamSearchIndexer, "remove_team", AsyncMock()) as remove_team,
            patch.object(TeamSearchIndexer, "sync_teams", AsyncMock()) as sync_teams,
        ):
            await ops.update(
                group_id=group.id,
                organization_id=ORG,
                actor_user_id=ACTOR,
                kind=GroupKind.ACCESS,
            )
        remove_team.assert_awaited_once_with(group.id, ORG)
        sync_teams.assert_awaited_once_with(ORG, detached)
        index_team.assert_not_awaited()

    async def test_promote_to_team_indexes(self) -> None:
        group = _group(kind=GroupKind.ACCESS)
        session = _session()
        ops = GroupOperations(session, _search_indexer())
        p = _ops_patches()
        with (
            _as_admin(),
            p[0],
            p[1],
            p[2],
            p[3],
            p[4],
            p[5],
            p[6],
            patch("uniffy.domains.groups.operations.sync_people_search", AsyncMock()),
            patch.object(GroupOperations, "_fetch", AsyncMock(return_value=group)),
            patch.object(GroupOperations, "_active_member_ids", AsyncMock(return_value=[])),
            patch.object(TeamSearchIndexer, "index_team", AsyncMock()) as index_team,
            patch.object(TeamSearchIndexer, "sync_teams", AsyncMock()),
            patch.object(TeamSearchIndexer, "child_team_ids", AsyncMock(return_value=[])),
        ):
            await ops.update(
                group_id=group.id,
                organization_id=ORG,
                actor_user_id=ACTOR,
                kind=GroupKind.TEAM,
            )
        index_team.assert_awaited_once_with(group)

    async def test_delete_team_tombstones_and_resyncs_children(self) -> None:
        group = _group()
        child_ids = [generate_id()]
        member_id = generate_id()
        session = _session([_rows_result([(member_id,)]), _scalar_result()])
        ops = GroupOperations(session, _search_indexer())
        p = _ops_patches()
        with (
            _as_admin(),
            p[0],
            p[1],
            p[2],
            p[3],
            p[4],
            p[5],
            p[6],
            patch("uniffy.domains.groups.operations.sync_people_search", AsyncMock()),
            patch.object(GroupOperations, "_fetch", AsyncMock(return_value=group)),
            patch.object(TeamSearchIndexer, "child_team_ids", AsyncMock(return_value=child_ids)),
            patch.object(TeamSearchIndexer, "remove_team", AsyncMock()) as remove_team,
            patch.object(TeamSearchIndexer, "sync_teams", AsyncMock()) as sync_teams,
        ):
            await ops.delete(group_id=group.id, organization_id=ORG, actor_user_id=ACTOR)
        remove_team.assert_awaited_once_with(group.id, ORG)
        sync_teams.assert_awaited_once_with(ORG, child_ids)

    async def test_member_change_reindexes_team_doc(self) -> None:
        group = _group()
        user_id = generate_id()
        session = _session()
        ops = GroupOperations(session, _search_indexer())
        p = _ops_patches()
        with (
            p[1],
            p[2],
            p[3],
            p[4],
            patch("uniffy.domains.groups.operations.sync_people_search", AsyncMock()),
            patch.object(TeamSearchIndexer, "index_team", AsyncMock()) as index_team,
        ):
            await ops._invalidate_team_membership(group, user_id)
        index_team.assert_awaited_once_with(group)

    async def test_member_change_on_access_group_skips_indexing(self) -> None:
        group = _group(kind=GroupKind.ACCESS)
        session = _session()
        ops = GroupOperations(session, _search_indexer())
        with (
            patch.object(TeamSearchIndexer, "index_team", AsyncMock()) as index_team,
            patch.object(TeamSearchIndexer, "remove_team", AsyncMock()),
        ):
            await ops._invalidate_team_membership(group, generate_id())
        index_team.assert_not_awaited()


class TestFirstTeamDerivation:
    async def test_rename_resyncs_member_docs(self) -> None:
        group = _group()
        member_ids = [generate_id()]
        session = _session()
        ops = GroupOperations(session, _search_indexer())
        p = _ops_patches()
        sync_people = AsyncMock()
        with (
            _as_admin(),
            p[0],
            p[1],
            p[2],
            p[3],
            p[4],
            p[5],
            p[6],
            patch("uniffy.domains.groups.operations.sync_people_search", sync_people),
            patch.object(GroupOperations, "_fetch", AsyncMock(return_value=group)),
            patch.object(GroupOperations, "_active_member_ids", AsyncMock(return_value=member_ids)),
            patch.object(TeamSearchIndexer, "index_team", AsyncMock()),
            patch.object(TeamSearchIndexer, "child_team_ids", AsyncMock(return_value=[])),
            patch.object(TeamSearchIndexer, "sync_teams", AsyncMock()),
        ):
            await ops.update(
                group_id=group.id,
                organization_id=ORG,
                actor_user_id=ACTOR,
                name="Platform Engineering",
            )
        sync_people.assert_awaited_once_with(session, ops.search_indexer, ORG, member_ids)
