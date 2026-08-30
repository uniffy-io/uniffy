"""Search policy and adapter filter-expression security guards."""

from collections.abc import Iterator
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.search.engine import (
    SearchAll,
    SearchAny,
    SearchDocumentsPage,
    SearchEngine,
    SearchEngineError,
    SearchFilter,
    SearchNot,
    SearchTerm,
    all_of,
)
from uniffy.core.search.policy import (
    FILTERABLE_METADATA_KEYS,
    build_candidate_filter,
    build_permission_filter,
)
from uniffy.core.search.workspace import WorkspaceSearch
from uniffy.core.types import generate_id
from uniffy.infrastructure.search.meili import escape_filter_value, render_filter


def _walk(expression: SearchFilter) -> Iterator[SearchFilter]:
    yield expression
    if isinstance(expression, SearchNot):
        yield from _walk(expression.expression)
    elif isinstance(expression, SearchAll | SearchAny):
        for nested in expression.expressions:
            yield from _walk(nested)


def _engine() -> MagicMock:
    engine = MagicMock(spec=SearchEngine)
    engine.fetch_documents = AsyncMock()
    engine.patch_documents = AsyncMock()
    return engine


class TestEscapeFilterValue:
    def test_escapes_quote_and_backslash(self) -> None:
        assert escape_filter_value('a"b') == 'a\\"b'
        assert escape_filter_value("a\\b") == "a\\\\b"

    def test_backslash_escaped_before_quote(self) -> None:
        assert escape_filter_value('\\"') == "\\" * 3 + '"'


class TestMeiliFilterRendering:
    def test_tag_filter_cannot_close_the_literal(self) -> None:
        expression = build_candidate_filter(
            organization_id=generate_id(),
            user_id=generate_id(),
            tag_filters=('x") OR (entity_type = "note',),
        )

        emitted = render_filter(expression)

        assert 'OR (entity_type = "note")' not in emitted
        assert '\\"' in emitted

    def test_rejects_fields_outside_the_engine_identifier_grammar(self) -> None:
        with pytest.raises(SearchEngineError, match="Invalid search filter field"):
            render_filter(SearchTerm('owner_id") OR true', "value"))


class TestSearchFilterAssembly:
    def test_unknown_metadata_key_is_dropped(self) -> None:
        expression = build_candidate_filter(
            organization_id=generate_id(),
            user_id=generate_id(),
            metadata_filters={'x" OR owner_id = "y': "z"},
        )

        assert not any(
            isinstance(item, SearchTerm) and item.field.startswith("metadata.x")
            for item in _walk(expression)
        )

    def test_declared_metadata_key_is_kept(self) -> None:
        metadata_key = next(iter(FILTERABLE_METADATA_KEYS))
        value = str(generate_id())

        expression = build_candidate_filter(
            organization_id=generate_id(),
            user_id=generate_id(),
            metadata_filters={metadata_key: value},
        )

        assert SearchTerm(f"metadata.{metadata_key}", value) in tuple(_walk(expression))


class TestOwnerFilterNarrowing:
    def test_owner_filter_does_not_replace_the_permission_clause(self) -> None:
        organization_id = generate_id()
        caller = generate_id()
        owner = generate_id()
        unfiltered = build_permission_filter(organization_id, caller)

        narrowed = build_permission_filter(organization_id, caller, owner_filter=owner)

        assert narrowed == all_of(unfiltered, SearchTerm("owner_id", str(owner)))


class TestChatMessagePermissions:
    def test_sender_ownership_cannot_bypass_channel_membership(self) -> None:
        caller = generate_id()
        expression = build_permission_filter(generate_id(), caller)
        ownership_grant = all_of(
            SearchNot(SearchTerm("entity_type", "chat_message")),
            SearchTerm("owner_id", str(caller)),
        )

        assert ownership_grant in tuple(_walk(expression))


class TestTaskSharingRefresh:
    async def test_updates_existing_task_documents_without_creating_missing_rows(self) -> None:
        engine = _engine()
        engine.fetch_documents.side_effect = [
            SearchDocumentsPage(({"id": "task-doc"},)),
            SearchDocumentsPage(()),
        ]
        search = WorkspaceSearch(engine)
        organization_id = generate_id()
        project_id = generate_id()
        owner_id = generate_id()
        viewer_id = generate_id()

        updated = await search.update_task_sharing(
            organization_id=organization_id,
            project_id=project_id,
            owner_id=owner_id,
            access_mode="EXPLICIT_MEMBERS",
            baseline_role=None,
            shared_user_ids=[viewer_id],
            shared_group_ids=[],
            blocked_user_ids=[],
            blocked_group_ids=[],
        )

        assert updated == 1
        expression = engine.fetch_documents.await_args_list[0].args[0]
        assert SearchTerm("metadata.project_id", str(project_id)) in tuple(_walk(expression))
        engine.patch_documents.assert_awaited_once_with(
            [
                {
                    "id": "task-doc",
                    "owner_id": str(owner_id),
                    "access_mode": "EXPLICIT_MEMBERS",
                    "baseline_role": None,
                    "shared_user_ids": [str(viewer_id)],
                    "shared_group_ids": [],
                    "blocked_user_ids": [],
                    "blocked_group_ids": [],
                }
            ],
            create_missing=False,
            wait=True,
        )


class TestUrnValidation:
    async def test_malformed_urn_never_reaches_the_filter(self) -> None:
        engine = _engine()
        search = WorkspaceSearch(engine)
        payload = 'a") OR (entity_type = "note") OR (urn = "b'

        await search.get_documents_by_urns([payload], generate_id())

        engine.fetch_documents.assert_not_awaited()

    async def test_valid_urn_is_queried(self) -> None:
        engine = _engine()
        engine.fetch_documents.return_value = SearchDocumentsPage(())
        search = WorkspaceSearch(engine)
        urn = f"urn:uniffy:content:NOTE:{generate_id()}"

        await search.get_documents_by_urns([urn], generate_id())

        expression = engine.fetch_documents.await_args.args[0]
        assert SearchTerm("urn", urn) in tuple(_walk(expression))


class TestBatchLookupFailures:
    async def test_raw_lookup_preserves_successful_chunks(self) -> None:
        engine = _engine()
        search = WorkspaceSearch(engine)
        urns = [f"urn:uniffy:content:NOTE:{generate_id()}" for _ in range(51)]
        engine.fetch_documents.side_effect = [
            SearchDocumentsPage(({"urn": urns[0]},)),
            RuntimeError("transport failed"),
        ]

        result = await search.get_documents_by_urns(urns, generate_id())

        assert result.documents == {urns[0]: {"urn": urns[0]}}
        assert result.failed_urns == frozenset({urns[50]})
        assert result.complete is False
