from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import generate_id
from uniffy.domains.agents.tools.builtin.people import (
    MAX_PEOPLE_RESULTS,
    PEOPLE_TOOLS,
    _execute_get_person,
    _execute_list_members,
    _execute_list_teams,
)
from uniffy.domains.agents.tools.definitions import ToolContext
from uniffy.domains.people.reader import PeoplePage


def _ctx() -> ToolContext:
    return ToolContext(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
    )


def _person(**overrides) -> dict:
    person = {
        "user_id": str(generate_id()),
        "display_name": "Clara Engineer",
        "username": "clara",
        "email": "clara@example.test",
        "job_title": "Backend Engineer",
        "department": "Engineering",
        "org_role": "MEMBER",
        "work_phone": "+1-work",
        "mobile_phone": "+1-private",
        "office_location": "Sofia",
        "timezone": "Europe/Sofia",
        "pronouns": "she/her",
        "bio": "Builds APIs.",
        "birthday": "03-14",
        "start_date": "2025-01-02",
        "links": [{"label": "Personal", "url": "https://private.test"}],
        "manager_user_id": None,
        "teams": [],
        "direct_report_count": 0,
        "managed_fields": ["job_title"],
    }
    person.update(overrides)
    return person


class TestDefinitions:
    def test_people_tool_catalog(self) -> None:
        by_name = {tool.name: tool for tool in PEOPLE_TOOLS}
        assert set(by_name) == {
            "people.list_members",
            "people.get_person",
            "people.list_teams",
        }
        assert all(tool.group == "People" for tool in PEOPLE_TOOLS)
        assert all(tool.read_only is True for tool in PEOPLE_TOOLS)
        assert by_name["people.list_members"].timeout_seconds == 30

    def test_member_search_schema_exposes_directory_filters(self) -> None:
        schema = PEOPLE_TOOLS[0].parameter_schema["properties"]
        assert set(schema) == {
            "query",
            "job_title",
            "department",
            "organization_role",
            "team_id",
            "manager_user_id",
            "limit",
        }
        assert schema["organization_role"]["enum"] == ["OWNER", "ADMIN", "MEMBER"]


class TestListMembers:
    async def test_forwards_composable_filters_and_formats_mentions(self) -> None:
        ctx = _ctx()
        team_id = generate_id()
        manager_id = generate_id()
        person = _person(
            manager_user_id=str(manager_id),
            teams=[{"group_id": str(team_id), "name": "Platform", "lead_user_id": None}],
            direct_report_count=2,
        )
        reader = MagicMock()
        reader.list_people = AsyncMock(
            return_value=PeoplePage(people=[person], total=1, is_admin=False)
        )

        with patch("uniffy.domains.people.reader.PeopleReader", return_value=reader):
            result = await _execute_list_members(
                ctx,
                {
                    "query": "clara",
                    "job_title": "Engineer",
                    "department": "Engineering",
                    "organization_role": "member",
                    "team_id": str(team_id),
                    "manager_user_id": str(manager_id),
                    "limit": 10_000,
                },
            )

        assert result.success is True
        assert "urn:uniffy:content:USER:" in result.data
        assert "Backend Engineer" in result.data
        assert "teams=Platform" in result.data
        kwargs = reader.list_people.await_args.kwargs
        assert kwargs["actor_user_id"] == ctx.user_id
        assert kwargs["organization_id"] == ctx.organization_id
        assert kwargs["role_filter"] is OrganizationRole.MEMBER
        assert kwargs["team_id"] == team_id
        assert kwargs["manager_user_id"] == manager_id
        assert kwargs["page_size"] == MAX_PEOPLE_RESULTS

    async def test_rejects_invalid_role_and_ids(self) -> None:
        ctx = _ctx()
        role = await _execute_list_members(ctx, {"organization_role": "superadmin"})
        team = await _execute_list_members(ctx, {"team_id": "not-a-uuid"})
        assert role.success is False
        assert "OWNER, ADMIN, or MEMBER" in role.error
        assert team.success is False
        assert "Invalid team_id" in team.error

    async def test_empty_result_is_not_an_error(self) -> None:
        reader = MagicMock()
        reader.list_people = AsyncMock(
            return_value=PeoplePage(people=[], total=0, is_admin=False)
        )
        with patch("uniffy.domains.people.reader.PeopleReader", return_value=reader):
            result = await _execute_list_members(_ctx(), {"query": "nobody"})
        assert result.success is True
        assert result.data == "No active organization members matched."


class TestGetPerson:
    async def test_returns_work_context_without_personal_profile_fields(self) -> None:
        ctx = _ctx()
        manager = _person(display_name="Morgan Manager", manager_user_id=None)
        person = _person(manager_user_id=manager["user_id"])
        reader = MagicMock()
        reader.get_person = AsyncMock(side_effect=[(person, False), (manager, False)])

        with patch("uniffy.domains.people.reader.PeopleReader", return_value=reader):
            result = await _execute_get_person(ctx, {"user_id": person["user_id"]})

        assert result.success is True
        assert "Morgan Manager" in result.data
        assert "clara@example.test" in result.data
        assert "+1-work" in result.data
        assert "+1-private" not in result.data
        assert "03-14" not in result.data
        assert "2025-01-02" not in result.data
        assert "https://private.test" not in result.data
        assert "managed_fields" not in result.data

    async def test_requires_a_valid_user_id(self) -> None:
        missing = await _execute_get_person(_ctx(), {})
        invalid = await _execute_get_person(_ctx(), {"user_id": "nope"})
        assert missing.success is False
        assert missing.error == "user_id is required"
        assert invalid.success is False
        assert "Invalid user_id" in invalid.error


class TestListTeams:
    async def test_member_gate_and_bounded_team_mentions(self) -> None:
        ctx = _ctx()
        team = {
            "group_id": str(generate_id()),
            "name": "Platform",
            "description": "Builds the core platform",
            "parent_group_id": None,
            "lead_user_id": str(generate_id()),
        }
        org_ops = MagicMock()
        org_ops.require_org_member = AsyncMock()
        search = AsyncMock(return_value=([team], 1))

        with (
            patch(
                "uniffy.domains.organizations.operations.OrganizationOperations",
                return_value=org_ops,
            ),
            patch("uniffy.domains.people.teams.search_team_nodes", search),
        ):
            result = await _execute_list_teams(ctx, {"query": "plat", "limit": 50_000})

        assert result.success is True
        assert "urn:uniffy:content:TEAM:" in result.data
        assert "lead_user_id=" in result.data
        org_ops.require_org_member.assert_awaited_once_with(ctx.user_id, ctx.organization_id)
        assert search.await_args.kwargs["limit"] == MAX_PEOPLE_RESULTS


@pytest.mark.parametrize("field", ["query", "job_title", "department"])
async def test_rejects_overlong_text_filters(field: str) -> None:
    result = await _execute_list_members(_ctx(), {field: "x" * 300})
    assert result.success is False
    assert "must be at most" in result.error
