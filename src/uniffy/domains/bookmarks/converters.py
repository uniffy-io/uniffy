"""Protobuf conversion for bookmark rows and resolved items."""

from uniffy_proto.bookmarks.v1.bookmarks_pb import Bookmark as ProtoBookmark
from uniffy_proto.bookmarks.v1.bookmarks_pb import BookmarkItem as ProtoBookmarkItem
from uniffy_proto.search.v1.search_pb import UrnAvailability, UrnMetadata

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.bookmarks.bookmark import Bookmark
from uniffy.domains.bookmarks.types import BookmarkItem
from uniffy.domains.search.converters import search_result_to_urn_metadata


def bookmark_to_proto(bookmark: Bookmark) -> ProtoBookmark:
    return ProtoBookmark(
        id=str(bookmark.id),
        user_id=str(bookmark.user_id),
        organization_id=str(bookmark.organization_id),
        urn=bookmark.urn,
        created_at=datetime_to_timestamp(bookmark.created_at),
    )


def bookmark_item_to_proto(item: BookmarkItem) -> ProtoBookmarkItem:
    content = (
        search_result_to_urn_metadata(item.content)
        if item.content is not None
        else UrnMetadata(availability=UrnAvailability.UNAVAILABLE)
    )
    return ProtoBookmarkItem(
        bookmark=bookmark_to_proto(item.bookmark),
        content=content,
    )
