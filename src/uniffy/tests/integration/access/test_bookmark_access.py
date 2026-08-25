from types import SimpleNamespace

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.bookmarks.bookmark import Bookmark
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.notes.note import Note
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.domains.bookmarks.operations import BookmarksOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_bookmark_listing_tracks_live_resource_access(
    session: AsyncSession,
    access: SimpleNamespace,
) -> None:
    note = await session.get(Note, access.org_note_id)
    assert note is not None
    note_urn = f"urn:uniffy:content:{ContentType.NOTE.value}:{note.id}"
    original_access_mode = note.access_mode
    original_baseline_role = note.baseline_role

    try:
        added, bookmark = await BookmarksOperations(session).toggle(
            access.peer_id,
            access.org_id,
            note_urn,
        )
        assert added is True
        assert bookmark is not None

        initial = await BookmarksOperations(session).list_bookmark_items(
            access.peer_id,
            access.org_id,
        )
        assert [item.bookmark.urn for item in initial.items] == [note_urn]

        note.access_mode = AccessMode.OWNER_ONLY
        note.baseline_role = None
        session.add(note)
        await session.commit()

        revoked = await BookmarksOperations(session).list_bookmark_items(
            access.peer_id,
            access.org_id,
        )
        assert revoked.items == []

        note.access_mode = AccessMode.OPEN_TO_ORG
        note.baseline_role = ContentRole.VIEWER
        session.add(note)
        await session.commit()

        restored = await BookmarksOperations(session).list_bookmark_items(
            access.peer_id,
            access.org_id,
        )
        assert [item.bookmark.urn for item in restored.items] == [note_urn]

        private_note = await session.get(Note, access.private_note_id)
        assert private_note is not None
        private_urn = f"urn:uniffy:content:{ContentType.NOTE.value}:{private_note.id}"
        with pytest.raises(PermissionDeniedError):
            await BookmarksOperations(session).toggle(
                access.peer_id,
                access.org_id,
                private_urn,
            )
    finally:
        note.access_mode = original_access_mode
        note.baseline_role = original_baseline_role
        session.add(note)
        await session.execute(
            delete(Bookmark).where(
                Bookmark.user_id == access.peer_id,
                Bookmark.organization_id == access.org_id,
            )
        )
        await session.commit()


async def test_same_user_urn_can_be_bookmarked_independently_across_organizations(
    session: AsyncSession,
    access: SimpleNamespace,
) -> None:
    user_urn = f"urn:uniffy:content:{ContentType.USER.value}:{access.peer_id}"
    second_membership = OrganizationMember(
        user_id=access.peer_id,
        organization_id=access.other_org_id,
        role=OrganizationRole.MEMBER,
    )
    session.add(second_membership)
    await session.commit()

    try:
        first_added, _ = await BookmarksOperations(session).toggle(
            access.peer_id,
            access.org_id,
            user_urn,
        )
        second_added, _ = await BookmarksOperations(session).toggle(
            access.peer_id,
            access.other_org_id,
            user_urn,
        )

        assert first_added is True
        assert second_added is True
        assert await BookmarksOperations(session).is_bookmarked(
            access.peer_id,
            access.org_id,
            user_urn,
        )
        assert await BookmarksOperations(session).is_bookmarked(
            access.peer_id,
            access.other_org_id,
            user_urn,
        )

        first_removed, _ = await BookmarksOperations(session).toggle(
            access.peer_id,
            access.org_id,
            user_urn,
        )
        assert first_removed is False
        assert not await BookmarksOperations(session).is_bookmarked(
            access.peer_id,
            access.org_id,
            user_urn,
        )
        assert await BookmarksOperations(session).is_bookmarked(
            access.peer_id,
            access.other_org_id,
            user_urn,
        )
    finally:
        await session.execute(
            delete(Bookmark).where(
                Bookmark.user_id == access.peer_id,
                Bookmark.organization_id.in_([access.org_id, access.other_org_id]),
                Bookmark.urn == user_urn,
            )
        )
        await session.delete(second_membership)
        await session.commit()


async def test_urn_aliases_cannot_create_duplicate_rows_for_one_content_item(
    session: AsyncSession,
    access: SimpleNamespace,
) -> None:
    """UUID spellings all resolve to the same row, so uq_bookmarks_user_org_urn holds."""
    peer = access.peer_id
    canonical = f"urn:uniffy:content:{ContentType.USER.value}:{peer}"
    aliases = [
        f"urn:uniffy:content:{ContentType.USER.value}:{peer.hex}",
        f"urn:uniffy:content:{ContentType.USER.value}:{str(peer).upper()}",
        f"urn:uniffy:content:{ContentType.USER.value}:{{{peer}}}",
        f"urn:uniffy:content:{ContentType.USER.value}:urn:uuid:{peer}",
    ]

    try:
        added, _ = await BookmarksOperations(session).toggle(peer, access.org_id, canonical)
        assert added is True

        for alias in aliases:
            assert await BookmarksOperations(session).is_bookmarked(peer, access.org_id, alias)
            checks = await BookmarksOperations(session).bulk_check(peer, access.org_id, [alias])
            assert checks == {alias: True}

        rows = (
            await session.execute(
                select(Bookmark).where(
                    Bookmark.user_id == peer,
                    Bookmark.organization_id == access.org_id,
                )
            )
        ).scalars().all()
        assert [row.urn for row in rows] == [canonical]
        assert rows[0].content_type is ContentType.USER

        # Toggling through an alias removes the canonical row rather than adding another.
        removed, _ = await BookmarksOperations(session).toggle(peer, access.org_id, aliases[0])
        assert removed is False
        assert not await BookmarksOperations(session).is_bookmarked(peer, access.org_id, canonical)
    finally:
        await session.execute(
            delete(Bookmark).where(
                Bookmark.user_id == peer,
                Bookmark.organization_id == access.org_id,
            )
        )
        await session.commit()
