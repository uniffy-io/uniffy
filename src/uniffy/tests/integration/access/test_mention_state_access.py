"""Mention-state delivery uses each recipient's current PostgreSQL access."""

import pytest

from uniffy.domains.notifications.tags import TagEventRelay

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_private_update_reaches_owner_but_not_peer(session, access) -> None:
    urn = f"urn:uniffy:content:NOTE:{access.private_note_id}"
    payload = {"urn": urn, "changes": {"title": "private update"}}

    assert await TagEventRelay(access.peer_id, access.org_id).allows_mention_state(payload) is False
    assert (
        await TagEventRelay(access.member_id, access.org_id).allows_mention_state(payload) is True
    )


async def test_type_only_tombstone_reaches_an_active_member(session, access) -> None:
    urn = f"urn:uniffy:content:NOTE:{access.private_note_id}"
    payload = {"urn": urn, "changes": {"urn_status": "DELETED"}}

    assert await TagEventRelay(access.peer_id, access.org_id).allows_mention_state(payload) is True
