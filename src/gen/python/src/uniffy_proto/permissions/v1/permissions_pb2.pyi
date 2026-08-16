import datetime

from common.v1 import common_pb2 as _common_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AccessRequestState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ACCESS_REQUEST_STATE_UNSPECIFIED: _ClassVar[AccessRequestState]
    ACCESS_REQUEST_STATE_PENDING: _ClassVar[AccessRequestState]
    ACCESS_REQUEST_STATE_APPROVED: _ClassVar[AccessRequestState]
    ACCESS_REQUEST_STATE_DENIED: _ClassVar[AccessRequestState]
    ACCESS_REQUEST_STATE_CANCELED: _ClassVar[AccessRequestState]

class AccessRequestDecision(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ACCESS_REQUEST_DECISION_UNSPECIFIED: _ClassVar[AccessRequestDecision]
    ACCESS_REQUEST_DECISION_APPROVE: _ClassVar[AccessRequestDecision]
    ACCESS_REQUEST_DECISION_DENY: _ClassVar[AccessRequestDecision]

class RequestAccessOutcome(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    REQUEST_ACCESS_OUTCOME_UNSPECIFIED: _ClassVar[RequestAccessOutcome]
    REQUEST_ACCESS_OUTCOME_CREATED: _ClassVar[RequestAccessOutcome]
    REQUEST_ACCESS_OUTCOME_ALREADY_PENDING: _ClassVar[RequestAccessOutcome]
    REQUEST_ACCESS_OUTCOME_ALREADY_ACCESSIBLE: _ClassVar[RequestAccessOutcome]
    REQUEST_ACCESS_OUTCOME_COOLDOWN: _ClassVar[RequestAccessOutcome]
ACCESS_REQUEST_STATE_UNSPECIFIED: AccessRequestState
ACCESS_REQUEST_STATE_PENDING: AccessRequestState
ACCESS_REQUEST_STATE_APPROVED: AccessRequestState
ACCESS_REQUEST_STATE_DENIED: AccessRequestState
ACCESS_REQUEST_STATE_CANCELED: AccessRequestState
ACCESS_REQUEST_DECISION_UNSPECIFIED: AccessRequestDecision
ACCESS_REQUEST_DECISION_APPROVE: AccessRequestDecision
ACCESS_REQUEST_DECISION_DENY: AccessRequestDecision
REQUEST_ACCESS_OUTCOME_UNSPECIFIED: RequestAccessOutcome
REQUEST_ACCESS_OUTCOME_CREATED: RequestAccessOutcome
REQUEST_ACCESS_OUTCOME_ALREADY_PENDING: RequestAccessOutcome
REQUEST_ACCESS_OUTCOME_ALREADY_ACCESSIBLE: RequestAccessOutcome
REQUEST_ACCESS_OUTCOME_COOLDOWN: RequestAccessOutcome

class ContentMember(_message.Message):
    __slots__ = ("subject_type", "subject_id", "role", "added_by_user_id", "added_at", "updated_at", "expires_at")
    SUBJECT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    ADDED_BY_USER_ID_FIELD_NUMBER: _ClassVar[int]
    ADDED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    subject_type: _common_pb2.SubjectType
    subject_id: str
    role: _common_pb2.ContentRole
    added_by_user_id: str
    added_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, subject_type: _Optional[_Union[_common_pb2.SubjectType, str]] = ..., subject_id: _Optional[str] = ..., role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., added_by_user_id: _Optional[str] = ..., added_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ContentAccessPolicy(_message.Message):
    __slots__ = ("owner_id", "access_mode", "baseline_role", "caller_role", "effective_access_mode")
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    CALLER_ROLE_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    owner_id: str
    access_mode: _common_pb2.AccessMode
    baseline_role: _common_pb2.ContentRole
    caller_role: _common_pb2.ContentRole
    effective_access_mode: _common_pb2.AccessMode
    def __init__(self, owner_id: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., caller_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., effective_access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ...) -> None: ...

class ContentMemberEvent(_message.Message):
    __slots__ = ("id", "content_type", "content_id", "action", "subject_type", "subject_id", "previous_role", "new_role", "previous_access_mode", "new_access_mode", "previous_baseline_role", "new_baseline_role", "previous_owner_id", "new_owner_id", "actor_user_id", "actor_org_role", "note", "occurred_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_ID_FIELD_NUMBER: _ClassVar[int]
    PREVIOUS_ROLE_FIELD_NUMBER: _ClassVar[int]
    NEW_ROLE_FIELD_NUMBER: _ClassVar[int]
    PREVIOUS_ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    NEW_ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    PREVIOUS_BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    NEW_BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    PREVIOUS_OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    NEW_OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    ACTOR_USER_ID_FIELD_NUMBER: _ClassVar[int]
    ACTOR_ORG_ROLE_FIELD_NUMBER: _ClassVar[int]
    NOTE_FIELD_NUMBER: _ClassVar[int]
    OCCURRED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    content_type: _common_pb2.ContentType
    content_id: str
    action: _common_pb2.ContentMemberAction
    subject_type: _common_pb2.SubjectType
    subject_id: str
    previous_role: _common_pb2.ContentRole
    new_role: _common_pb2.ContentRole
    previous_access_mode: _common_pb2.AccessMode
    new_access_mode: _common_pb2.AccessMode
    previous_baseline_role: _common_pb2.ContentRole
    new_baseline_role: _common_pb2.ContentRole
    previous_owner_id: str
    new_owner_id: str
    actor_user_id: str
    actor_org_role: _common_pb2.OrganizationRole
    note: str
    occurred_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ..., action: _Optional[_Union[_common_pb2.ContentMemberAction, str]] = ..., subject_type: _Optional[_Union[_common_pb2.SubjectType, str]] = ..., subject_id: _Optional[str] = ..., previous_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., new_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., previous_access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., new_access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., previous_baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., new_baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., previous_owner_id: _Optional[str] = ..., new_owner_id: _Optional[str] = ..., actor_user_id: _Optional[str] = ..., actor_org_role: _Optional[_Union[_common_pb2.OrganizationRole, str]] = ..., note: _Optional[str] = ..., occurred_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ContentAccessRequest(_message.Message):
    __slots__ = ("id", "organization_id", "requested_urn", "original_content_type", "original_content_id", "canonical_content_type", "canonical_content_id", "requester_id", "requester_display_name", "state", "message", "decision_note", "approved_role", "responded_by_user_id", "created_at", "updated_at", "responded_at", "can_request_again_at", "requester_has_access")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_URN_FIELD_NUMBER: _ClassVar[int]
    ORIGINAL_CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    ORIGINAL_CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    CANONICAL_CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CANONICAL_CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    REQUESTER_ID_FIELD_NUMBER: _ClassVar[int]
    REQUESTER_DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    DECISION_NOTE_FIELD_NUMBER: _ClassVar[int]
    APPROVED_ROLE_FIELD_NUMBER: _ClassVar[int]
    RESPONDED_BY_USER_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    RESPONDED_AT_FIELD_NUMBER: _ClassVar[int]
    CAN_REQUEST_AGAIN_AT_FIELD_NUMBER: _ClassVar[int]
    REQUESTER_HAS_ACCESS_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    requested_urn: str
    original_content_type: _common_pb2.ContentType
    original_content_id: str
    canonical_content_type: _common_pb2.ContentType
    canonical_content_id: str
    requester_id: str
    requester_display_name: str
    state: AccessRequestState
    message: str
    decision_note: str
    approved_role: _common_pb2.ContentRole
    responded_by_user_id: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    responded_at: _timestamp_pb2.Timestamp
    can_request_again_at: _timestamp_pb2.Timestamp
    requester_has_access: bool
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., requested_urn: _Optional[str] = ..., original_content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., original_content_id: _Optional[str] = ..., canonical_content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., canonical_content_id: _Optional[str] = ..., requester_id: _Optional[str] = ..., requester_display_name: _Optional[str] = ..., state: _Optional[_Union[AccessRequestState, str]] = ..., message: _Optional[str] = ..., decision_note: _Optional[str] = ..., approved_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., responded_by_user_id: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., responded_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., can_request_again_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., requester_has_access: _Optional[bool] = ...) -> None: ...

class AccessRequestStatus(_message.Message):
    __slots__ = ("requested_urn", "state", "request_id", "can_request_again_at", "requester_has_access")
    REQUESTED_URN_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    CAN_REQUEST_AGAIN_AT_FIELD_NUMBER: _ClassVar[int]
    REQUESTER_HAS_ACCESS_FIELD_NUMBER: _ClassVar[int]
    requested_urn: str
    state: AccessRequestState
    request_id: str
    can_request_again_at: _timestamp_pb2.Timestamp
    requester_has_access: bool
    def __init__(self, requested_urn: _Optional[str] = ..., state: _Optional[_Union[AccessRequestState, str]] = ..., request_id: _Optional[str] = ..., can_request_again_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., requester_has_access: _Optional[bool] = ...) -> None: ...

class ListMembersRequest(_message.Message):
    __slots__ = ("organization_id", "content_type", "content_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_type: _common_pb2.ContentType
    content_id: str
    def __init__(self, organization_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ...) -> None: ...

class ListMembersResponse(_message.Message):
    __slots__ = ("policy", "members")
    POLICY_FIELD_NUMBER: _ClassVar[int]
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    policy: ContentAccessPolicy
    members: _containers.RepeatedCompositeFieldContainer[ContentMember]
    def __init__(self, policy: _Optional[_Union[ContentAccessPolicy, _Mapping]] = ..., members: _Optional[_Iterable[_Union[ContentMember, _Mapping]]] = ...) -> None: ...

class AddMemberRequest(_message.Message):
    __slots__ = ("organization_id", "content_type", "content_id", "subject_type", "subject_id", "role", "expires_at", "note")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    NOTE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_type: _common_pb2.ContentType
    content_id: str
    subject_type: _common_pb2.SubjectType
    subject_id: str
    role: _common_pb2.ContentRole
    expires_at: _timestamp_pb2.Timestamp
    note: str
    def __init__(self, organization_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ..., subject_type: _Optional[_Union[_common_pb2.SubjectType, str]] = ..., subject_id: _Optional[str] = ..., role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., note: _Optional[str] = ...) -> None: ...

class UpdateMemberRoleRequest(_message.Message):
    __slots__ = ("organization_id", "content_type", "content_id", "subject_type", "subject_id", "new_role", "note")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_ID_FIELD_NUMBER: _ClassVar[int]
    NEW_ROLE_FIELD_NUMBER: _ClassVar[int]
    NOTE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_type: _common_pb2.ContentType
    content_id: str
    subject_type: _common_pb2.SubjectType
    subject_id: str
    new_role: _common_pb2.ContentRole
    note: str
    def __init__(self, organization_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ..., subject_type: _Optional[_Union[_common_pb2.SubjectType, str]] = ..., subject_id: _Optional[str] = ..., new_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., note: _Optional[str] = ...) -> None: ...

class RemoveMemberRequest(_message.Message):
    __slots__ = ("organization_id", "content_type", "content_id", "subject_type", "subject_id", "note")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_ID_FIELD_NUMBER: _ClassVar[int]
    NOTE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_type: _common_pb2.ContentType
    content_id: str
    subject_type: _common_pb2.SubjectType
    subject_id: str
    note: str
    def __init__(self, organization_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ..., subject_type: _Optional[_Union[_common_pb2.SubjectType, str]] = ..., subject_id: _Optional[str] = ..., note: _Optional[str] = ...) -> None: ...

class RemoveMemberResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class SetAccessModeRequest(_message.Message):
    __slots__ = ("organization_id", "content_type", "content_id", "access_mode", "baseline_role", "remove_members_on_narrow", "note")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    REMOVE_MEMBERS_ON_NARROW_FIELD_NUMBER: _ClassVar[int]
    NOTE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_type: _common_pb2.ContentType
    content_id: str
    access_mode: _common_pb2.AccessMode
    baseline_role: _common_pb2.ContentRole
    remove_members_on_narrow: bool
    note: str
    def __init__(self, organization_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., remove_members_on_narrow: _Optional[bool] = ..., note: _Optional[str] = ...) -> None: ...

class SetAccessModeResponse(_message.Message):
    __slots__ = ("policy",)
    POLICY_FIELD_NUMBER: _ClassVar[int]
    policy: ContentAccessPolicy
    def __init__(self, policy: _Optional[_Union[ContentAccessPolicy, _Mapping]] = ...) -> None: ...

class TransferOwnershipRequest(_message.Message):
    __slots__ = ("organization_id", "content_type", "content_id", "new_owner_user_id", "note")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    NEW_OWNER_USER_ID_FIELD_NUMBER: _ClassVar[int]
    NOTE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_type: _common_pb2.ContentType
    content_id: str
    new_owner_user_id: str
    note: str
    def __init__(self, organization_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ..., new_owner_user_id: _Optional[str] = ..., note: _Optional[str] = ...) -> None: ...

class TransferOwnershipResponse(_message.Message):
    __slots__ = ("policy",)
    POLICY_FIELD_NUMBER: _ClassVar[int]
    policy: ContentAccessPolicy
    def __init__(self, policy: _Optional[_Union[ContentAccessPolicy, _Mapping]] = ...) -> None: ...

class AddMemberResponse(_message.Message):
    __slots__ = ("member",)
    MEMBER_FIELD_NUMBER: _ClassVar[int]
    member: ContentMember
    def __init__(self, member: _Optional[_Union[ContentMember, _Mapping]] = ...) -> None: ...

class UpdateMemberRoleResponse(_message.Message):
    __slots__ = ("member",)
    MEMBER_FIELD_NUMBER: _ClassVar[int]
    member: ContentMember
    def __init__(self, member: _Optional[_Union[ContentMember, _Mapping]] = ...) -> None: ...

class ListMemberEventsRequest(_message.Message):
    __slots__ = ("organization_id", "content_type", "content_id", "pagination", "actor_user_id", "action", "after", "before")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    ACTOR_USER_ID_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    AFTER_FIELD_NUMBER: _ClassVar[int]
    BEFORE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_type: _common_pb2.ContentType
    content_id: str
    pagination: _common_pb2.PaginationRequest
    actor_user_id: str
    action: _common_pb2.ContentMemberAction
    after: _timestamp_pb2.Timestamp
    before: _timestamp_pb2.Timestamp
    def __init__(self, organization_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ..., actor_user_id: _Optional[str] = ..., action: _Optional[_Union[_common_pb2.ContentMemberAction, str]] = ..., after: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., before: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListMemberEventsResponse(_message.Message):
    __slots__ = ("events", "pagination")
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    events: _containers.RepeatedCompositeFieldContainer[ContentMemberEvent]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, events: _Optional[_Iterable[_Union[ContentMemberEvent, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class RequestAccessRequest(_message.Message):
    __slots__ = ("organization_id", "requested_urn", "message")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_URN_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    requested_urn: str
    message: str
    def __init__(self, organization_id: _Optional[str] = ..., requested_urn: _Optional[str] = ..., message: _Optional[str] = ...) -> None: ...

class RequestAccessResponse(_message.Message):
    __slots__ = ("outcome", "access_request", "can_request_again_at")
    OUTCOME_FIELD_NUMBER: _ClassVar[int]
    ACCESS_REQUEST_FIELD_NUMBER: _ClassVar[int]
    CAN_REQUEST_AGAIN_AT_FIELD_NUMBER: _ClassVar[int]
    outcome: RequestAccessOutcome
    access_request: ContentAccessRequest
    can_request_again_at: _timestamp_pb2.Timestamp
    def __init__(self, outcome: _Optional[_Union[RequestAccessOutcome, str]] = ..., access_request: _Optional[_Union[ContentAccessRequest, _Mapping]] = ..., can_request_again_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class GetMyAccessRequestStatusesRequest(_message.Message):
    __slots__ = ("organization_id", "requested_urns")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_URNS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    requested_urns: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., requested_urns: _Optional[_Iterable[str]] = ...) -> None: ...

class GetMyAccessRequestStatusesResponse(_message.Message):
    __slots__ = ("statuses",)
    STATUSES_FIELD_NUMBER: _ClassVar[int]
    statuses: _containers.RepeatedCompositeFieldContainer[AccessRequestStatus]
    def __init__(self, statuses: _Optional[_Iterable[_Union[AccessRequestStatus, _Mapping]]] = ...) -> None: ...

class GetAccessRequestRequest(_message.Message):
    __slots__ = ("organization_id", "request_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    request_id: str
    def __init__(self, organization_id: _Optional[str] = ..., request_id: _Optional[str] = ...) -> None: ...

class GetAccessRequestResponse(_message.Message):
    __slots__ = ("access_request",)
    ACCESS_REQUEST_FIELD_NUMBER: _ClassVar[int]
    access_request: ContentAccessRequest
    def __init__(self, access_request: _Optional[_Union[ContentAccessRequest, _Mapping]] = ...) -> None: ...

class ListAccessRequestsRequest(_message.Message):
    __slots__ = ("organization_id", "canonical_content_type", "canonical_content_id", "state", "pagination")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CANONICAL_CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CANONICAL_CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    canonical_content_type: _common_pb2.ContentType
    canonical_content_id: str
    state: AccessRequestState
    pagination: _common_pb2.PaginationRequest
    def __init__(self, organization_id: _Optional[str] = ..., canonical_content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., canonical_content_id: _Optional[str] = ..., state: _Optional[_Union[AccessRequestState, str]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ...) -> None: ...

class ListAccessRequestsResponse(_message.Message):
    __slots__ = ("access_requests", "pagination")
    ACCESS_REQUESTS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    access_requests: _containers.RepeatedCompositeFieldContainer[ContentAccessRequest]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, access_requests: _Optional[_Iterable[_Union[ContentAccessRequest, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class RespondToAccessRequestRequest(_message.Message):
    __slots__ = ("organization_id", "request_id", "decision", "approved_role", "decision_note")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    DECISION_FIELD_NUMBER: _ClassVar[int]
    APPROVED_ROLE_FIELD_NUMBER: _ClassVar[int]
    DECISION_NOTE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    request_id: str
    decision: AccessRequestDecision
    approved_role: _common_pb2.ContentRole
    decision_note: str
    def __init__(self, organization_id: _Optional[str] = ..., request_id: _Optional[str] = ..., decision: _Optional[_Union[AccessRequestDecision, str]] = ..., approved_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., decision_note: _Optional[str] = ...) -> None: ...

class RespondToAccessRequestResponse(_message.Message):
    __slots__ = ("access_request",)
    ACCESS_REQUEST_FIELD_NUMBER: _ClassVar[int]
    access_request: ContentAccessRequest
    def __init__(self, access_request: _Optional[_Union[ContentAccessRequest, _Mapping]] = ...) -> None: ...

class CancelAccessRequestRequest(_message.Message):
    __slots__ = ("organization_id", "request_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    request_id: str
    def __init__(self, organization_id: _Optional[str] = ..., request_id: _Optional[str] = ...) -> None: ...

class CancelAccessRequestResponse(_message.Message):
    __slots__ = ("access_request",)
    ACCESS_REQUEST_FIELD_NUMBER: _ClassVar[int]
    access_request: ContentAccessRequest
    def __init__(self, access_request: _Optional[_Union[ContentAccessRequest, _Mapping]] = ...) -> None: ...
