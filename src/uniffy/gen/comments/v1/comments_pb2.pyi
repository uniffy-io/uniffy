import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from common.v1 import common_pb2 as _common_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CommentAnchorType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    COMMENT_ANCHOR_TYPE_UNSPECIFIED: _ClassVar[CommentAnchorType]
    COMMENT_ANCHOR_TYPE_PAGE: _ClassVar[CommentAnchorType]
    COMMENT_ANCHOR_TYPE_SELECTION: _ClassVar[CommentAnchorType]
    COMMENT_ANCHOR_TYPE_BLOCK: _ClassVar[CommentAnchorType]
    COMMENT_ANCHOR_TYPE_MEDIA: _ClassVar[CommentAnchorType]
COMMENT_ANCHOR_TYPE_UNSPECIFIED: CommentAnchorType
COMMENT_ANCHOR_TYPE_PAGE: CommentAnchorType
COMMENT_ANCHOR_TYPE_SELECTION: CommentAnchorType
COMMENT_ANCHOR_TYPE_BLOCK: CommentAnchorType
COMMENT_ANCHOR_TYPE_MEDIA: CommentAnchorType

class Comment(_message.Message):
    __slots__ = ("id", "organization_id", "content_type", "content_id", "parent_comment_id", "author_id", "author_name", "author_avatar_url", "body", "anchor_type", "anchor_data", "is_resolved", "resolved_by_id", "resolved_by_name", "resolved_at", "created_at", "updated_at", "reply_count", "reactions", "replies")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    PARENT_COMMENT_ID_FIELD_NUMBER: _ClassVar[int]
    AUTHOR_ID_FIELD_NUMBER: _ClassVar[int]
    AUTHOR_NAME_FIELD_NUMBER: _ClassVar[int]
    AUTHOR_AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    BODY_FIELD_NUMBER: _ClassVar[int]
    ANCHOR_TYPE_FIELD_NUMBER: _ClassVar[int]
    ANCHOR_DATA_FIELD_NUMBER: _ClassVar[int]
    IS_RESOLVED_FIELD_NUMBER: _ClassVar[int]
    RESOLVED_BY_ID_FIELD_NUMBER: _ClassVar[int]
    RESOLVED_BY_NAME_FIELD_NUMBER: _ClassVar[int]
    RESOLVED_AT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    REPLY_COUNT_FIELD_NUMBER: _ClassVar[int]
    REACTIONS_FIELD_NUMBER: _ClassVar[int]
    REPLIES_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    content_type: _common_pb2.ContentType
    content_id: str
    parent_comment_id: str
    author_id: str
    author_name: str
    author_avatar_url: str
    body: str
    anchor_type: CommentAnchorType
    anchor_data: _struct_pb2.Struct
    is_resolved: bool
    resolved_by_id: str
    resolved_by_name: str
    resolved_at: _timestamp_pb2.Timestamp
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    reply_count: int
    reactions: _containers.RepeatedCompositeFieldContainer[CommentReaction]
    replies: _containers.RepeatedCompositeFieldContainer[Comment]
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ..., parent_comment_id: _Optional[str] = ..., author_id: _Optional[str] = ..., author_name: _Optional[str] = ..., author_avatar_url: _Optional[str] = ..., body: _Optional[str] = ..., anchor_type: _Optional[_Union[CommentAnchorType, str]] = ..., anchor_data: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., is_resolved: _Optional[bool] = ..., resolved_by_id: _Optional[str] = ..., resolved_by_name: _Optional[str] = ..., resolved_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., reply_count: _Optional[int] = ..., reactions: _Optional[_Iterable[_Union[CommentReaction, _Mapping]]] = ..., replies: _Optional[_Iterable[_Union[Comment, _Mapping]]] = ...) -> None: ...

class CommentReaction(_message.Message):
    __slots__ = ("emoji", "count", "user_ids", "current_user_reacted")
    EMOJI_FIELD_NUMBER: _ClassVar[int]
    COUNT_FIELD_NUMBER: _ClassVar[int]
    USER_IDS_FIELD_NUMBER: _ClassVar[int]
    CURRENT_USER_REACTED_FIELD_NUMBER: _ClassVar[int]
    emoji: str
    count: int
    user_ids: _containers.RepeatedScalarFieldContainer[str]
    current_user_reacted: bool
    def __init__(self, emoji: _Optional[str] = ..., count: _Optional[int] = ..., user_ids: _Optional[_Iterable[str]] = ..., current_user_reacted: _Optional[bool] = ...) -> None: ...

class ContentRef(_message.Message):
    __slots__ = ("content_type", "content_id")
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    content_type: _common_pb2.ContentType
    content_id: str
    def __init__(self, content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ...) -> None: ...

class CreateCommentRequest(_message.Message):
    __slots__ = ("organization_id", "content_type", "content_id", "parent_comment_id", "body", "anchor_type", "anchor_data")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    PARENT_COMMENT_ID_FIELD_NUMBER: _ClassVar[int]
    BODY_FIELD_NUMBER: _ClassVar[int]
    ANCHOR_TYPE_FIELD_NUMBER: _ClassVar[int]
    ANCHOR_DATA_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_type: _common_pb2.ContentType
    content_id: str
    parent_comment_id: str
    body: str
    anchor_type: CommentAnchorType
    anchor_data: _struct_pb2.Struct
    def __init__(self, organization_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ..., parent_comment_id: _Optional[str] = ..., body: _Optional[str] = ..., anchor_type: _Optional[_Union[CommentAnchorType, str]] = ..., anchor_data: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...

class CreateCommentResponse(_message.Message):
    __slots__ = ("comment",)
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    comment: Comment
    def __init__(self, comment: _Optional[_Union[Comment, _Mapping]] = ...) -> None: ...

class UpdateCommentRequest(_message.Message):
    __slots__ = ("organization_id", "comment_id", "body")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    COMMENT_ID_FIELD_NUMBER: _ClassVar[int]
    BODY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    comment_id: str
    body: str
    def __init__(self, organization_id: _Optional[str] = ..., comment_id: _Optional[str] = ..., body: _Optional[str] = ...) -> None: ...

class UpdateCommentResponse(_message.Message):
    __slots__ = ("comment",)
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    comment: Comment
    def __init__(self, comment: _Optional[_Union[Comment, _Mapping]] = ...) -> None: ...

class DeleteCommentRequest(_message.Message):
    __slots__ = ("organization_id", "comment_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    COMMENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    comment_id: str
    def __init__(self, organization_id: _Optional[str] = ..., comment_id: _Optional[str] = ...) -> None: ...

class DeleteCommentResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class ListCommentsRequest(_message.Message):
    __slots__ = ("organization_id", "content_type", "content_id", "is_resolved", "anchor_type", "page", "page_size")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    IS_RESOLVED_FIELD_NUMBER: _ClassVar[int]
    ANCHOR_TYPE_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_type: _common_pb2.ContentType
    content_id: str
    is_resolved: bool
    anchor_type: CommentAnchorType
    page: int
    page_size: int
    def __init__(self, organization_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ..., is_resolved: _Optional[bool] = ..., anchor_type: _Optional[_Union[CommentAnchorType, str]] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class ListCommentsResponse(_message.Message):
    __slots__ = ("comments", "total_count", "open_count", "resolved_count")
    COMMENTS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    OPEN_COUNT_FIELD_NUMBER: _ClassVar[int]
    RESOLVED_COUNT_FIELD_NUMBER: _ClassVar[int]
    comments: _containers.RepeatedCompositeFieldContainer[Comment]
    total_count: int
    open_count: int
    resolved_count: int
    def __init__(self, comments: _Optional[_Iterable[_Union[Comment, _Mapping]]] = ..., total_count: _Optional[int] = ..., open_count: _Optional[int] = ..., resolved_count: _Optional[int] = ...) -> None: ...

class GetCommentRequest(_message.Message):
    __slots__ = ("organization_id", "comment_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    COMMENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    comment_id: str
    def __init__(self, organization_id: _Optional[str] = ..., comment_id: _Optional[str] = ...) -> None: ...

class GetCommentResponse(_message.Message):
    __slots__ = ("comment",)
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    comment: Comment
    def __init__(self, comment: _Optional[_Union[Comment, _Mapping]] = ...) -> None: ...

class ResolveCommentRequest(_message.Message):
    __slots__ = ("organization_id", "comment_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    COMMENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    comment_id: str
    def __init__(self, organization_id: _Optional[str] = ..., comment_id: _Optional[str] = ...) -> None: ...

class ResolveCommentResponse(_message.Message):
    __slots__ = ("comment",)
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    comment: Comment
    def __init__(self, comment: _Optional[_Union[Comment, _Mapping]] = ...) -> None: ...

class ReopenCommentRequest(_message.Message):
    __slots__ = ("organization_id", "comment_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    COMMENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    comment_id: str
    def __init__(self, organization_id: _Optional[str] = ..., comment_id: _Optional[str] = ...) -> None: ...

class ReopenCommentResponse(_message.Message):
    __slots__ = ("comment",)
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    comment: Comment
    def __init__(self, comment: _Optional[_Union[Comment, _Mapping]] = ...) -> None: ...

class AddReactionRequest(_message.Message):
    __slots__ = ("organization_id", "comment_id", "emoji")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    COMMENT_ID_FIELD_NUMBER: _ClassVar[int]
    EMOJI_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    comment_id: str
    emoji: str
    def __init__(self, organization_id: _Optional[str] = ..., comment_id: _Optional[str] = ..., emoji: _Optional[str] = ...) -> None: ...

class AddReactionResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class RemoveReactionRequest(_message.Message):
    __slots__ = ("organization_id", "comment_id", "emoji")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    COMMENT_ID_FIELD_NUMBER: _ClassVar[int]
    EMOJI_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    comment_id: str
    emoji: str
    def __init__(self, organization_id: _Optional[str] = ..., comment_id: _Optional[str] = ..., emoji: _Optional[str] = ...) -> None: ...

class RemoveReactionResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class GetCommentCountsRequest(_message.Message):
    __slots__ = ("organization_id", "content_refs")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_REFS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_refs: _containers.RepeatedCompositeFieldContainer[ContentRef]
    def __init__(self, organization_id: _Optional[str] = ..., content_refs: _Optional[_Iterable[_Union[ContentRef, _Mapping]]] = ...) -> None: ...

class GetCommentCountsResponse(_message.Message):
    __slots__ = ("counts",)
    class CountsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: int
        def __init__(self, key: _Optional[str] = ..., value: _Optional[int] = ...) -> None: ...
    COUNTS_FIELD_NUMBER: _ClassVar[int]
    counts: _containers.ScalarMap[str, int]
    def __init__(self, counts: _Optional[_Mapping[str, int]] = ...) -> None: ...
