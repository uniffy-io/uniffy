import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SupportSessionScope(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SUPPORT_SESSION_SCOPE_UNSPECIFIED: _ClassVar[SupportSessionScope]
    SUPPORT_SESSION_SCOPE_READ_ONLY: _ClassVar[SupportSessionScope]
    SUPPORT_SESSION_SCOPE_READ_WRITE: _ClassVar[SupportSessionScope]

class SupportSessionState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SUPPORT_SESSION_STATE_UNSPECIFIED: _ClassVar[SupportSessionState]
    SUPPORT_SESSION_STATE_PENDING: _ClassVar[SupportSessionState]
    SUPPORT_SESSION_STATE_ACTIVE: _ClassVar[SupportSessionState]
    SUPPORT_SESSION_STATE_EXPIRED: _ClassVar[SupportSessionState]
    SUPPORT_SESSION_STATE_REVOKED: _ClassVar[SupportSessionState]
    SUPPORT_SESSION_STATE_REJECTED: _ClassVar[SupportSessionState]

class SupportConsentMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SUPPORT_CONSENT_MODE_UNSPECIFIED: _ClassVar[SupportConsentMode]
    SUPPORT_CONSENT_MODE_OWNER_APPROVED: _ClassVar[SupportConsentMode]
    SUPPORT_CONSENT_MODE_OPERATOR_JUSTIFIED: _ClassVar[SupportConsentMode]
SUPPORT_SESSION_SCOPE_UNSPECIFIED: SupportSessionScope
SUPPORT_SESSION_SCOPE_READ_ONLY: SupportSessionScope
SUPPORT_SESSION_SCOPE_READ_WRITE: SupportSessionScope
SUPPORT_SESSION_STATE_UNSPECIFIED: SupportSessionState
SUPPORT_SESSION_STATE_PENDING: SupportSessionState
SUPPORT_SESSION_STATE_ACTIVE: SupportSessionState
SUPPORT_SESSION_STATE_EXPIRED: SupportSessionState
SUPPORT_SESSION_STATE_REVOKED: SupportSessionState
SUPPORT_SESSION_STATE_REJECTED: SupportSessionState
SUPPORT_CONSENT_MODE_UNSPECIFIED: SupportConsentMode
SUPPORT_CONSENT_MODE_OWNER_APPROVED: SupportConsentMode
SUPPORT_CONSENT_MODE_OPERATOR_JUSTIFIED: SupportConsentMode

class SupportSession(_message.Message):
    __slots__ = ("id", "organization_id", "organization_name", "organization_slug", "support_user_id", "support_user_email", "support_user_full_name", "requested_by_user_id", "granted_by_user_id", "granted_by_email", "revoked_by_user_id", "revoked_by_email", "reason", "scope", "state", "requested_at", "granted_at", "expires_at", "revoked_at", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_NAME_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_SLUG_FIELD_NUMBER: _ClassVar[int]
    SUPPORT_USER_ID_FIELD_NUMBER: _ClassVar[int]
    SUPPORT_USER_EMAIL_FIELD_NUMBER: _ClassVar[int]
    SUPPORT_USER_FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_BY_USER_ID_FIELD_NUMBER: _ClassVar[int]
    GRANTED_BY_USER_ID_FIELD_NUMBER: _ClassVar[int]
    GRANTED_BY_EMAIL_FIELD_NUMBER: _ClassVar[int]
    REVOKED_BY_USER_ID_FIELD_NUMBER: _ClassVar[int]
    REVOKED_BY_EMAIL_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_AT_FIELD_NUMBER: _ClassVar[int]
    GRANTED_AT_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    REVOKED_AT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    organization_name: str
    organization_slug: str
    support_user_id: str
    support_user_email: str
    support_user_full_name: str
    requested_by_user_id: str
    granted_by_user_id: str
    granted_by_email: str
    revoked_by_user_id: str
    revoked_by_email: str
    reason: str
    scope: SupportSessionScope
    state: SupportSessionState
    requested_at: _timestamp_pb2.Timestamp
    granted_at: _timestamp_pb2.Timestamp
    expires_at: _timestamp_pb2.Timestamp
    revoked_at: _timestamp_pb2.Timestamp
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., organization_name: _Optional[str] = ..., organization_slug: _Optional[str] = ..., support_user_id: _Optional[str] = ..., support_user_email: _Optional[str] = ..., support_user_full_name: _Optional[str] = ..., requested_by_user_id: _Optional[str] = ..., granted_by_user_id: _Optional[str] = ..., granted_by_email: _Optional[str] = ..., revoked_by_user_id: _Optional[str] = ..., revoked_by_email: _Optional[str] = ..., reason: _Optional[str] = ..., scope: _Optional[_Union[SupportSessionScope, str]] = ..., state: _Optional[_Union[SupportSessionState, str]] = ..., requested_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., granted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., revoked_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class RequestSessionRequest(_message.Message):
    __slots__ = ("organization_id", "reason", "scope", "duration_minutes")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    DURATION_MINUTES_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    reason: str
    scope: SupportSessionScope
    duration_minutes: int
    def __init__(self, organization_id: _Optional[str] = ..., reason: _Optional[str] = ..., scope: _Optional[_Union[SupportSessionScope, str]] = ..., duration_minutes: _Optional[int] = ...) -> None: ...

class RequestSessionResponse(_message.Message):
    __slots__ = ("session",)
    SESSION_FIELD_NUMBER: _ClassVar[int]
    session: SupportSession
    def __init__(self, session: _Optional[_Union[SupportSession, _Mapping]] = ...) -> None: ...

class ApproveSessionRequest(_message.Message):
    __slots__ = ("session_id",)
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    def __init__(self, session_id: _Optional[str] = ...) -> None: ...

class ApproveSessionResponse(_message.Message):
    __slots__ = ("session",)
    SESSION_FIELD_NUMBER: _ClassVar[int]
    session: SupportSession
    def __init__(self, session: _Optional[_Union[SupportSession, _Mapping]] = ...) -> None: ...

class RejectSessionRequest(_message.Message):
    __slots__ = ("session_id", "reason")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    reason: str
    def __init__(self, session_id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class RejectSessionResponse(_message.Message):
    __slots__ = ("session",)
    SESSION_FIELD_NUMBER: _ClassVar[int]
    session: SupportSession
    def __init__(self, session: _Optional[_Union[SupportSession, _Mapping]] = ...) -> None: ...

class RevokeSessionRequest(_message.Message):
    __slots__ = ("session_id", "reason")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    reason: str
    def __init__(self, session_id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class RevokeSessionResponse(_message.Message):
    __slots__ = ("session",)
    SESSION_FIELD_NUMBER: _ClassVar[int]
    session: SupportSession
    def __init__(self, session: _Optional[_Union[SupportSession, _Mapping]] = ...) -> None: ...

class ListMySessionsRequest(_message.Message):
    __slots__ = ("page", "page_size", "include_inactive")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_INACTIVE_FIELD_NUMBER: _ClassVar[int]
    page: int
    page_size: int
    include_inactive: bool
    def __init__(self, page: _Optional[int] = ..., page_size: _Optional[int] = ..., include_inactive: _Optional[bool] = ...) -> None: ...

class ListMySessionsResponse(_message.Message):
    __slots__ = ("sessions", "total_count", "page", "page_size")
    SESSIONS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    sessions: _containers.RepeatedCompositeFieldContainer[SupportSession]
    total_count: int
    page: int
    page_size: int
    def __init__(self, sessions: _Optional[_Iterable[_Union[SupportSession, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class ListOrgSessionsRequest(_message.Message):
    __slots__ = ("organization_id", "page", "page_size", "include_inactive")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_INACTIVE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    page: int
    page_size: int
    include_inactive: bool
    def __init__(self, organization_id: _Optional[str] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ..., include_inactive: _Optional[bool] = ...) -> None: ...

class ListOrgSessionsResponse(_message.Message):
    __slots__ = ("sessions", "total_count", "page", "page_size")
    SESSIONS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    sessions: _containers.RepeatedCompositeFieldContainer[SupportSession]
    total_count: int
    page: int
    page_size: int
    def __init__(self, sessions: _Optional[_Iterable[_Union[SupportSession, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class ListAllSessionsRequest(_message.Message):
    __slots__ = ("page", "page_size", "state", "search")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    SEARCH_FIELD_NUMBER: _ClassVar[int]
    page: int
    page_size: int
    state: SupportSessionState
    search: str
    def __init__(self, page: _Optional[int] = ..., page_size: _Optional[int] = ..., state: _Optional[_Union[SupportSessionState, str]] = ..., search: _Optional[str] = ...) -> None: ...

class ListAllSessionsResponse(_message.Message):
    __slots__ = ("sessions", "total_count", "page", "page_size")
    SESSIONS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    sessions: _containers.RepeatedCompositeFieldContainer[SupportSession]
    total_count: int
    page: int
    page_size: int
    def __init__(self, sessions: _Optional[_Iterable[_Union[SupportSession, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class SupportConsentModeView(_message.Message):
    __slots__ = ("deployment_mode", "org_override", "effective", "locked_by_deployment")
    DEPLOYMENT_MODE_FIELD_NUMBER: _ClassVar[int]
    ORG_OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_FIELD_NUMBER: _ClassVar[int]
    LOCKED_BY_DEPLOYMENT_FIELD_NUMBER: _ClassVar[int]
    deployment_mode: SupportConsentMode
    org_override: SupportConsentMode
    effective: SupportConsentMode
    locked_by_deployment: bool
    def __init__(self, deployment_mode: _Optional[_Union[SupportConsentMode, str]] = ..., org_override: _Optional[_Union[SupportConsentMode, str]] = ..., effective: _Optional[_Union[SupportConsentMode, str]] = ..., locked_by_deployment: _Optional[bool] = ...) -> None: ...

class GetOrgConsentModeRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetOrgConsentModeResponse(_message.Message):
    __slots__ = ("view",)
    VIEW_FIELD_NUMBER: _ClassVar[int]
    view: SupportConsentModeView
    def __init__(self, view: _Optional[_Union[SupportConsentModeView, _Mapping]] = ...) -> None: ...

class SetOrgConsentModeRequest(_message.Message):
    __slots__ = ("organization_id", "mode")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    MODE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    mode: SupportConsentMode
    def __init__(self, organization_id: _Optional[str] = ..., mode: _Optional[_Union[SupportConsentMode, str]] = ...) -> None: ...

class SetOrgConsentModeResponse(_message.Message):
    __slots__ = ("view",)
    VIEW_FIELD_NUMBER: _ClassVar[int]
    view: SupportConsentModeView
    def __init__(self, view: _Optional[_Union[SupportConsentModeView, _Mapping]] = ...) -> None: ...
