from unittest.mock import MagicMock

from uniffy.core.models.chat.message import ChatMessageMetadataKind
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.types import generate_id
from uniffy.domains.agents.tools.builtin.dashboard import _execute_propose, dashboard_propose
from uniffy.domains.agents.tools.builtin.registration import register_all
from uniffy.domains.agents.tools.definitions import ToolContext
from uniffy.domains.agents.tools.registry import ToolRegistry
from uniffy.domains.settings.dashboard.definition import load_catalog


def _ctx() -> ToolContext:
    return ToolContext(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
        buffer=UpdateBuffer(),
    )


def test_the_tool_is_registered_read_only_in_its_own_group() -> None:
    registry = ToolRegistry()
    register_all(registry)
    tool = registry.get("dashboard.propose")
    assert tool is dashboard_propose
    assert tool.read_only and not tool.destructive
    assert tool.group == "Dashboard"


def test_the_schema_offers_exactly_the_widget_catalog() -> None:
    widget_enum = dashboard_propose.parameter_schema["properties"]["widgets"]["items"]["properties"][
        "widget"
    ]["enum"]
    assert widget_enum == [widget.widget_id for widget in load_catalog().widgets]


async def test_a_proposal_returns_a_preview_and_saves_nothing() -> None:
    ctx = _ctx()
    result = await _execute_propose(
        ctx,
        {
            "description": "QA view",
            "widgets": [
                {"widget": "review-queue", "projects": "my_projects"},
                {"widget": "bug-trend", "people": "everyone", "sprint": "active"},
                {"widget": "today-agenda"},
            ],
        },
    )
    assert result.success, result.error
    assert result.metadata is not None
    assert result.metadata["kind"] == ChatMessageMetadataKind.DASHBOARD_PROPOSAL
    assert result.metadata["organization_id"] == str(ctx.organization_id)
    assert result.metadata["definition"]["name"] == "QA view"
    widgets = result.metadata["definition"]["widgets"]
    assert [w["id"] for w in widgets] == ["review-queue", "bug-trend", "today-agenda"]
    assert widgets[0]["filters"]["projects"] == "my_projects"
    assert widgets[1]["filters"]["sprint"] == "active"
    ctx.session.commit.assert_not_called()
    ctx.session.add.assert_not_called()


async def test_unknown_widgets_and_filters_are_refused() -> None:
    unknown = await _execute_propose(
        _ctx(), {"description": "x", "widgets": [{"widget": "revenue-chart"}]}
    )
    assert not unknown.success and "Unknown widget" in (unknown.error or "")
    bad_scope = await _execute_propose(
        _ctx(), {"description": "x", "widgets": [{"widget": "workload", "people": "managers"}]}
    )
    assert not bad_scope.success
    duplicate = await _execute_propose(
        _ctx(), {"description": "x", "widgets": [{"widget": "my-time"}, {"widget": "my-time"}]}
    )
    assert not duplicate.success
