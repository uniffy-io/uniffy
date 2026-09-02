"""Regression guard: org and domain admins get NO bypass when listing notes.

`list_notes` powers the personal notes sidebar. The bug this guards against was
a silent admin bypass that returned every org note unfiltered, which surfaced as
other people's private notes under "Shared With Me". The only honest way to
check that is to put a private note in the database and confirm the admin's
list does not contain it.
"""

import pytest

from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.notes.reader import NoteReader

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _ids(session, user_id, org_id, **kwargs) -> set:
    notes, _ = await NoteReader(session).list_notes(
        user_id=user_id, organization_id=org_id, page_size=100, **kwargs
    )
    return {note.id for note in notes}


class TestNoAdminBypass:
    async def test_org_admin_never_sees_another_members_private_note(self, session, access) -> None:
        listed = await _ids(session, access.admin_id, access.org_id)
        assert access.private_note_id not in listed

    async def test_org_owner_never_sees_another_members_private_note(self, session, access) -> None:
        listed = await _ids(session, access.owner_id, access.org_id)
        assert access.private_note_id not in listed

    async def test_admin_sees_exactly_what_a_member_would(self, session, access) -> None:
        """The admin owns one note and the org-wide notes are open; nothing else."""
        listed = await _ids(session, access.admin_id, access.org_id)
        assert listed == {
            access.admin_note_id,
            access.org_note_id,
            access.blocked_note_id,
        }

    async def test_the_owner_of_the_private_note_still_sees_it(self, session, access) -> None:
        assert access.private_note_id in await _ids(session, access.member_id, access.org_id)

    async def test_admin_count_matches_the_filtered_page(self, session, access) -> None:
        """A bypass in the count query alone would inflate the total."""
        notes, total = await NoteReader(session).list_notes(
            user_id=access.admin_id, organization_id=access.org_id, page_size=100
        )
        assert total == len(notes)


class TestGrantsAndBlocks:
    async def test_an_explicit_grant_is_honoured(self, session, access) -> None:
        assert access.shared_note_id in await _ids(session, access.peer_id, access.org_id)

    async def test_a_group_grant_is_honoured(self, session, access) -> None:
        assert access.group_note_id in await _ids(session, access.peer_id, access.org_id)

    async def test_a_group_grant_reaches_only_group_members(self, session, access) -> None:
        assert access.group_note_id not in await _ids(session, access.admin_id, access.org_id)

    async def test_blocked_beats_the_org_baseline(self, session, access) -> None:
        listed = await _ids(session, access.peer_id, access.org_id)
        assert access.org_note_id in listed
        assert access.blocked_note_id not in listed

    async def test_open_to_org_reaches_every_member(self, session, access) -> None:
        for user_id in (access.admin_id, access.peer_id, access.owner_id):
            assert access.org_note_id in await _ids(session, user_id, access.org_id)


class TestScoping:
    async def test_personal_only_narrows_to_owned_rows(self, session, access) -> None:
        listed = await _ids(session, access.member_id, access.org_id, personal_only=True)
        assert listed == {
            access.private_note_id,
            access.shared_note_id,
            access.org_note_id,
            access.blocked_note_id,
            access.group_note_id,
        }

    async def test_personal_only_excludes_granted_rows(self, session, access) -> None:
        """A grant is not ownership; personal_only must drop it."""
        assert await _ids(session, access.peer_id, access.org_id, personal_only=True) == set()

    async def test_personal_only_gives_an_admin_nothing_extra(self, session, access) -> None:
        listed = await _ids(session, access.admin_id, access.org_id, personal_only=True)
        assert listed == {access.admin_note_id}

    async def test_a_deactivated_member_reaches_nothing(self, session, access) -> None:
        """Membership is a precondition; even OPEN_TO_ORG stops."""
        assert await _ids(session, access.ghost_id, access.org_id) == set()

    async def test_a_non_member_reaches_nothing(self, session, access) -> None:
        assert await _ids(session, access.outsider_id, access.org_id) == set()

    async def test_another_orgs_notes_never_appear(self, session, access) -> None:
        assert await _ids(session, access.member_id, access.other_org_id) == set()

    async def test_unknown_org_lists_nothing(self, session, access) -> None:
        assert await _ids(session, access.member_id, generate_id()) == set()


class TestFilters:
    async def test_access_mode_filter_narrows_within_the_permitted_set(
        self, session, access
    ) -> None:
        listed = await _ids(
            session,
            access.member_id,
            access.org_id,
            access_mode=AccessMode.OWNER_ONLY,
        )
        assert listed == {access.private_note_id}
