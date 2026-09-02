import pytest
from sqlalchemy import update

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.comments.comment import Comment, CommentAnchorType
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.types import ContentRole, ContentType
from uniffy.domains.comments.operations import CommentOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_comment_floor_requires_commenter(session, access) -> None:
    operations = CommentOperations(session)

    with pytest.raises(PermissionDeniedError):
        await operations.create_comment(
            access.peer_id,
            access.org_id,
            ContentType.NOTE,
            access.shared_note_id,
            "explicit viewer attempt",
        )

    with pytest.raises(PermissionDeniedError):
        await operations.create_comment(
            access.peer_id,
            access.org_id,
            ContentType.NOTE,
            access.org_note_id,
            "baseline viewer attempt",
        )

    await session.execute(
        update(ContentMember)
        .where(
            ContentMember.content_id == access.shared_note_id,
            ContentMember.subject_id == access.peer_id,
        )
        .values(role=ContentRole.COMMENTER)
    )
    await session.commit()

    comment, _, _ = await operations.create_comment(
        access.peer_id,
        access.org_id,
        ContentType.NOTE,
        access.shared_note_id,
        "commenter attempt",
    )
    assert comment.author_id == access.peer_id
    assert await operations.add_reaction(access.peer_id, access.org_id, comment.id, "ok")

    await session.execute(
        update(ContentMember)
        .where(
            ContentMember.content_id == access.shared_note_id,
            ContentMember.subject_id == access.peer_id,
        )
        .values(role=ContentRole.VIEWER)
    )
    await session.commit()

    with pytest.raises(PermissionDeniedError):
        await operations.add_reaction(access.peer_id, access.org_id, comment.id, "eyes")
    assert await operations.remove_reaction(access.peer_id, access.org_id, comment.id, "ok")

    owner_comment, _, _ = await operations.create_comment(
        access.member_id,
        access.org_id,
        ContentType.NOTE,
        access.private_note_id,
        "owner attempt",
    )
    assert owner_comment.author_id == access.member_id


async def test_comment_author_loses_mutation_access_with_parent_access(session, access) -> None:
    comment = Comment(
        organization_id=access.org_id,
        content_type=ContentType.NOTE,
        content_id=access.private_note_id,
        author_id=access.peer_id,
        body="No longer visible",
        anchor_type=CommentAnchorType.PAGE,
    )
    session.add(comment)
    await session.commit()

    operations = CommentOperations(session)
    with pytest.raises(PermissionDeniedError):
        await operations.update_comment(
            access.peer_id,
            access.org_id,
            comment.id,
            "Still should not be editable",
        )
    with pytest.raises(PermissionDeniedError):
        await operations.delete_comment(access.peer_id, access.org_id, comment.id)
    with pytest.raises(PermissionDeniedError):
        await operations.remove_reaction(access.peer_id, access.org_id, comment.id, "ok")


async def test_comment_counts_only_include_authorized_parents(session, access) -> None:
    private_comment = Comment(
        organization_id=access.org_id,
        content_type=ContentType.NOTE,
        content_id=access.private_note_id,
        author_id=access.member_id,
        body="Private",
        anchor_type=CommentAnchorType.PAGE,
    )
    visible_comment = Comment(
        organization_id=access.org_id,
        content_type=ContentType.NOTE,
        content_id=access.org_note_id,
        author_id=access.member_id,
        body="Visible",
        anchor_type=CommentAnchorType.PAGE,
    )
    session.add_all([private_comment, visible_comment])
    await session.commit()

    counts = await CommentOperations(session).get_comment_counts(
        access.peer_id,
        access.org_id,
        [
            (ContentType.NOTE, access.private_note_id),
            (ContentType.NOTE, access.org_note_id),
        ],
    )

    assert f"NOTE:{access.private_note_id}" not in counts
    assert counts[f"NOTE:{access.org_note_id}"] == 1
