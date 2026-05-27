"""Proto <-> domain converters for comments domain."""

from google.protobuf.struct_pb2 import Struct
from uniffy_proto.comments.v1.comments_pb2 import (
    Comment as ProtoComment,
)
from uniffy_proto.comments.v1.comments_pb2 import (
    CommentAnchorType as ProtoAnchorType,
)
from uniffy_proto.comments.v1.comments_pb2 import (
    CommentReaction as ProtoCommentReaction,
)

from uniffy.core.converters import (
    CONTENT_TYPE_TO_PROTO,
    datetime_to_timestamp,
    optional_timestamp,
)
from uniffy.core.models.comments.comment import Comment, CommentAnchorType

ANCHOR_TYPE_TO_PROTO: dict[CommentAnchorType, int] = {
    CommentAnchorType.PAGE: ProtoAnchorType.COMMENT_ANCHOR_TYPE_PAGE,
    CommentAnchorType.SELECTION: ProtoAnchorType.COMMENT_ANCHOR_TYPE_SELECTION,
    CommentAnchorType.BLOCK: ProtoAnchorType.COMMENT_ANCHOR_TYPE_BLOCK,
    CommentAnchorType.MEDIA: ProtoAnchorType.COMMENT_ANCHOR_TYPE_MEDIA,
}

ANCHOR_TYPE_FROM_PROTO: dict[int, CommentAnchorType] = {
    ProtoAnchorType.COMMENT_ANCHOR_TYPE_PAGE: CommentAnchorType.PAGE,
    ProtoAnchorType.COMMENT_ANCHOR_TYPE_SELECTION: CommentAnchorType.SELECTION,
    ProtoAnchorType.COMMENT_ANCHOR_TYPE_BLOCK: CommentAnchorType.BLOCK,
    ProtoAnchorType.COMMENT_ANCHOR_TYPE_MEDIA: CommentAnchorType.MEDIA,
}


def anchor_type_to_proto(anchor_type: CommentAnchorType) -> int:
    return ANCHOR_TYPE_TO_PROTO.get(anchor_type, ProtoAnchorType.COMMENT_ANCHOR_TYPE_PAGE)


def anchor_type_from_proto(proto_type: int) -> CommentAnchorType:
    return ANCHOR_TYPE_FROM_PROTO.get(proto_type, CommentAnchorType.PAGE)


def comment_to_proto(
    comment: Comment,
    author_name: str,
    author_avatar_url: str | None,
    reply_count: int,
    reactions: list[dict],
    current_user_id: str,
    replies: list[ProtoComment] | None = None,
    resolved_by_name: str | None = None,
) -> ProtoComment:
    proto = ProtoComment(
        id=str(comment.id),
        organization_id=str(comment.organization_id),
        content_type=CONTENT_TYPE_TO_PROTO.get(comment.content_type, 0),
        content_id=str(comment.content_id),
        author_id=str(comment.author_id),
        author_name=author_name,
        body=comment.body,
        anchor_type=anchor_type_to_proto(comment.anchor_type),
        is_resolved=comment.is_resolved,
        created_at=datetime_to_timestamp(comment.created_at),
        reply_count=reply_count,
    )

    if comment.parent_comment_id:
        proto.parent_comment_id = str(comment.parent_comment_id)

    if author_avatar_url:
        proto.author_avatar_url = author_avatar_url

    if comment.anchor_data:
        anchor_struct = Struct()
        anchor_struct.update(comment.anchor_data)
        proto.anchor_data.CopyFrom(anchor_struct)

    if comment.resolved_by:
        proto.resolved_by_id = str(comment.resolved_by)
    if resolved_by_name:
        proto.resolved_by_name = resolved_by_name
    if comment.resolved_at:
        resolved_ts = optional_timestamp(comment.resolved_at)
        if resolved_ts:
            proto.resolved_at.CopyFrom(resolved_ts)

    if comment.updated_at:
        updated_ts = optional_timestamp(comment.updated_at)
        if updated_ts:
            proto.updated_at.CopyFrom(updated_ts)

    for reaction_data in reactions:
        proto.reactions.append(
            reaction_to_proto(
                emoji=reaction_data["emoji"],
                count=reaction_data["count"],
                user_ids=reaction_data["user_ids"],
                current_user_id=current_user_id,
            )
        )

    if replies:
        proto.replies.extend(replies)

    return proto


def reaction_to_proto(
    emoji: str,
    count: int,
    user_ids: list[str],
    current_user_id: str,
) -> ProtoCommentReaction:
    return ProtoCommentReaction(
        emoji=emoji,
        count=count,
        user_ids=user_ids,
        current_user_reacted=current_user_id in user_ids,
    )
