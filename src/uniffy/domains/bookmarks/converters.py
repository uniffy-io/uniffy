"""Proto <-> domain converters for bookmarks domain."""

from uniffy_proto.bookmarks.v1.bookmarks_pb2 import Bookmark as ProtoBookmark

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.bookmarks.bookmark import Bookmark


def bookmark_to_proto(bookmark: Bookmark) -> ProtoBookmark:
    """
    Convert Bookmark model to proto Bookmark.

    Parameters
    ----------
    bookmark : Bookmark
        Bookmark model instance.

    Returns
    -------
    ProtoBookmark
        Proto message.

    """
    return ProtoBookmark(
        id=str(bookmark.id),
        user_id=str(bookmark.user_id),
        organization_id=str(bookmark.organization_id),
        urn=bookmark.urn,
        created_at=datetime_to_timestamp(bookmark.created_at),
    )
