from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.notes.note import Note
from uniffy.core.search.policy import build_document_id
from uniffy.core.search.workspace import WorkspaceSearch
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType, generate_id
from uniffy.domains.search.operations import SearchOperations
from uniffy.domains.search.queries import UrnAvailability
from uniffy.infrastructure.search import MeiliSearchEngine

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _document(*, urn: str, organization_id, owner_id, title: str, shared_user_ids):
    return {
        "id": build_document_id(urn, organization_id),
        "urn": urn,
        "organization_id": str(organization_id),
        "title": title,
        "content": title,
        "description": f"Private description for {title}",
        "entity_type": "note",
        "url_path": f"/notes/{urn.rsplit(':', 1)[-1]}",
        "access_mode": AccessMode.EXPLICIT_MEMBERS.value,
        "baseline_role": None,
        "owner_id": str(owner_id),
        "shared_user_ids": [str(user_id) for user_id in shared_user_ids],
        "shared_group_ids": [],
        "blocked_user_ids": [],
        "blocked_group_ids": [],
        "attendee_user_ids": [],
        "tags": [],
        "rank_score": 1.0,
        "metadata": {},
        "updated_at": int(datetime.now(UTC).timestamp()),
    }


async def test_stale_meili_allows_never_cross_the_postgres_gate(session, access) -> None:
    search = WorkspaceSearch(MeiliSearchEngine())
    await search.startup()
    suffix = generate_id().hex[:12]
    stale_title = f"StaleAllow{suffix}"
    allowed_title = f"AllowedHit{suffix}"
    stale_urn = f"urn:uniffy:content:NOTE:{access.private_note_id}"
    allowed_urn = f"urn:uniffy:content:NOTE:{access.shared_note_id}"
    documents = [
        _document(
            urn=stale_urn,
            organization_id=access.org_id,
            owner_id=access.member_id,
            title=stale_title,
            shared_user_ids=[access.peer_id],
        ),
        _document(
            urn=allowed_urn,
            organization_id=access.org_id,
            owner_id=access.member_id,
            title=allowed_title,
            shared_user_ids=[access.peer_id],
        ),
    ]
    await search.engine.patch_documents(documents, wait=True)

    try:
        operations = SearchOperations(session, search)
        stale_results, _, _ = await operations.search(
            access.peer_id,
            access.org_id,
            stale_title,
        )
        allowed_results, _, _ = await operations.search(
            access.peer_id,
            access.org_id,
            allowed_title,
        )
        resolved = await operations.resolve_urns(
            access.peer_id,
            access.org_id,
            [stale_urn, allowed_urn],
        )

        assert stale_results == []
        assert [result.urn for result in allowed_results] == [allowed_urn]
        assert resolved[stale_urn].availability is UrnAvailability.RESTRICTED
        assert resolved[stale_urn].title == ""
        assert resolved[stale_urn].description is None
        assert resolved[stale_urn].can_request_access is True
        assert resolved[allowed_urn].availability is UrnAvailability.AVAILABLE
        assert resolved[allowed_urn].title == allowed_title

        grant = (
            await session.execute(
                select(ContentMember).where(
                    ContentMember.organization_id == access.org_id,
                    ContentMember.content_type == ContentType.NOTE,
                    ContentMember.content_id == access.shared_note_id,
                    ContentMember.subject_type == SubjectType.USER,
                    ContentMember.subject_id == access.peer_id,
                )
            )
        ).scalar_one()
        grant.role = ContentRole.BLOCKED
        session.add(grant)
        await session.commit()

        blocked_results, _, _ = await operations.search(
            access.peer_id,
            access.org_id,
            allowed_title,
        )
        blocked_resolve = await operations.resolve_urns(
            access.peer_id,
            access.org_id,
            [allowed_urn],
        )

        assert blocked_results == []
        assert blocked_resolve[allowed_urn].availability is UrnAvailability.RESTRICTED
        assert blocked_resolve[allowed_urn].title == ""

        note = await session.get(Note, access.shared_note_id)
        note.is_deleted = True
        session.add(note)
        await session.commit()
        deleted_resolve = await operations.resolve_urns(
            access.peer_id,
            access.org_id,
            [allowed_urn],
        )

        assert deleted_resolve[allowed_urn].availability is UrnAvailability.DELETED
        assert deleted_resolve[allowed_urn].title == ""
    finally:
        for urn in (stale_urn, allowed_urn):
            await search.delete_document(urn, access.org_id)
        await search.shutdown()
