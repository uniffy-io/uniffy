"""Filter-expression construction guards for the Meilisearch read path.

Every value interpolated into a filter sits next to the permission clause, and
Meili binds AND tighter than OR, so an unescaped quote lets a caller append a
disjunct the permission clause never constrains.
"""

from unittest.mock import AsyncMock, MagicMock

from uniffy.core.search.meilisearch import (
    FILTERABLE_METADATA_KEYS,
    MeilisearchClient,
    escape_filter_value,
)
from uniffy.core.types import generate_id
from uniffy.domains.search import queries


def _client_capturing_filter() -> tuple[MeilisearchClient, MagicMock]:
    client = MeilisearchClient.__new__(MeilisearchClient)
    index = MagicMock()
    index.search = AsyncMock(return_value=MagicMock(hits=[]))
    index.get_documents = AsyncMock(return_value=MagicMock(results=[]))
    client._client = MagicMock()
    client._client.index = MagicMock(return_value=index)
    client.config = MagicMock()
    client.config.index_name = "uniffy"
    return client, index


class TestEscapeFilterValue:
    def test_escapes_quote_and_backslash(self) -> None:
        assert escape_filter_value('a"b') == 'a\\"b'
        assert escape_filter_value("a\\b") == "a\\\\b"

    def test_backslash_escaped_before_quote(self) -> None:
        # A quote-first pass would emit \\" and leave the quote live.
        assert escape_filter_value('\\"') == '\\\\\\"'


class TestSearchFilterAssembly:
    async def test_tag_filter_cannot_close_the_literal(self) -> None:
        client, index = _client_capturing_filter()
        await client.search(
            query="",
            organization_id=generate_id(),
            user_id=generate_id(),
            tag_filters=['x") OR (entity_type = "note'],
        )
        emitted = index.search.await_args.kwargs["filter"]
        assert 'OR (entity_type = "note")' not in emitted
        assert '\\"' in emitted

    async def test_unknown_metadata_key_is_dropped(self) -> None:
        client, index = _client_capturing_filter()
        await client.search(
            query="",
            organization_id=generate_id(),
            user_id=generate_id(),
            metadata_filters={'x" OR owner_id = "y': "z"},
        )
        emitted = index.search.await_args.kwargs["filter"]
        assert "metadata.x" not in emitted

    async def test_declared_metadata_key_is_kept(self) -> None:
        client, index = _client_capturing_filter()
        channel_id = str(generate_id())
        await client.search(
            query="",
            organization_id=generate_id(),
            user_id=generate_id(),
            metadata_filters={"channel_id": channel_id},
        )
        emitted = index.search.await_args.kwargs["filter"]
        assert f'metadata.channel_id = "{channel_id}"' in emitted


class TestMetadataKeyAllowlist:
    def test_tracks_the_declared_filterable_attributes(self) -> None:
        assert {
            "channel_id",
            "sender_id",
            "project_id",
            "folder_id",
        } == FILTERABLE_METADATA_KEYS


class TestOwnerFilterNarrowing:
    def test_owner_filter_does_not_replace_the_permission_clause(self) -> None:
        client = MeilisearchClient.__new__(MeilisearchClient)
        caller = generate_id()
        victim = generate_id()
        unfiltered = client._build_permission_filter(generate_id(), caller)
        narrowed = client._build_permission_filter(generate_id(), caller, owner_filter=victim)
        assert narrowed.endswith(f'AND owner_id = "{victim}"')
        assert f'NOT blocked_user_ids = "{caller}"' in narrowed
        assert f'shared_user_ids = "{caller}"' in narrowed
        # Same shape as the unfiltered filter, plus one conjunct.
        assert len(narrowed) > len(unfiltered)


class TestChatMessagePermissions:
    def test_sender_ownership_cannot_bypass_channel_membership(self) -> None:
        client = MeilisearchClient.__new__(MeilisearchClient)
        caller = generate_id()

        filter_expr = client._build_permission_filter(generate_id(), caller)

        assert f'(entity_type != "chat_message" AND owner_id = "{caller}")' in filter_expr
        assert f' OR owner_id = "{caller}"' not in filter_expr


class TestUrnValidation:
    async def test_malformed_urn_never_reaches_the_filter(self) -> None:
        client, index = _client_capturing_filter()
        payload = 'a") OR (entity_type = "note") OR (urn = "b'
        await client.get_documents_by_urns([payload], generate_id())
        assert index.get_documents.await_count == 0

    async def test_valid_urn_is_queried(self) -> None:
        client, index = _client_capturing_filter()
        urn = f"urn:uniffy:content:NOTE:{generate_id()}"
        await client.get_documents_by_urns([urn], generate_id())
        emitted = index.get_documents.await_args.kwargs["filter"]
        assert f'urn = "{urn}"' in emitted

    async def test_permission_scoped_lookup_drops_injection(self, monkeypatch) -> None:
        client, index = _client_capturing_filter()
        monkeypatch.setattr(queries, "get_meilisearch_client", lambda: client)
        payload = 'a") OR (entity_type = "note") OR (urn = "b'
        good = f"urn:uniffy:content:NOTE:{generate_id()}"

        await queries.get_documents_by_urns([payload, good], generate_id(), generate_id(), [])

        emitted = index.get_documents.await_args.kwargs["filter"]
        assert payload not in emitted
        assert f'urn = "{good}"' in emitted
