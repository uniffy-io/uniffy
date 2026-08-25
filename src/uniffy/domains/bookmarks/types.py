from dataclasses import dataclass

from uniffy.core.models.bookmarks.bookmark import Bookmark
from uniffy.domains.search.queries import SearchResult


@dataclass(frozen=True, slots=True)
class BookmarkItem:
    bookmark: Bookmark
    content: SearchResult | None


@dataclass(frozen=True, slots=True)
class BookmarkItemsPage:
    items: list[BookmarkItem]
    next_page_token: str | None
