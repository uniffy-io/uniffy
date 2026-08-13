"""Proto <-> domain mapping for support session views and enums."""

from __future__ import annotations

from datetime import datetime

from google.protobuf.timestamp_pb2 import Timestamp
from uniffy_proto.support.v1.support_consent_pb2 import (
    SupportConsentMode as SupportConsentModeProto,
)
from uniffy_proto.support.v1.support_consent_pb2 import (
    SupportConsentModeView as SupportConsentModeViewProto,
)
from uniffy_proto.support.v1.support_consent_pb2 import (
    SupportSession as SupportSessionProto,
)
from uniffy_proto.support.v1.support_consent_pb2 import (
    SupportSessionScope as SupportSessionScopeProto,
)
from uniffy_proto.support.v1.support_consent_pb2 import (
    SupportSessionState as SupportSessionStateProto,
)

from uniffy.core.models.platform.support_session import (
    SupportSessionScope,
    SupportSessionState,
)
from uniffy.domains.platform.support_session.operations import (
    ConsentModeView,
    SupportSessionView,
)
from uniffy.domains.platform.support_session.policy import ConsentMode

_CONSENT_TO_PROTO: dict[ConsentMode, int] = {
    ConsentMode.OWNER_APPROVED: SupportConsentModeProto.SUPPORT_CONSENT_MODE_OWNER_APPROVED,
    ConsentMode.OPERATOR_JUSTIFIED: SupportConsentModeProto.SUPPORT_CONSENT_MODE_OPERATOR_JUSTIFIED,
}

_CONSENT_FROM_PROTO: dict[int, ConsentMode | None] = {
    SupportConsentModeProto.SUPPORT_CONSENT_MODE_UNSPECIFIED: None,
    SupportConsentModeProto.SUPPORT_CONSENT_MODE_OWNER_APPROVED: ConsentMode.OWNER_APPROVED,
    SupportConsentModeProto.SUPPORT_CONSENT_MODE_OPERATOR_JUSTIFIED: ConsentMode.OPERATOR_JUSTIFIED,
}


def consent_mode_from_proto(value: int) -> ConsentMode | None:
    """UNSPECIFIED -> None (clears the override)."""
    return _CONSENT_FROM_PROTO.get(value)


def _consent_to_proto(mode: ConsentMode | None) -> int:
    if mode is None:
        return SupportConsentModeProto.SUPPORT_CONSENT_MODE_UNSPECIFIED
    return _CONSENT_TO_PROTO[mode]


def consent_view_to_proto(view: ConsentModeView) -> SupportConsentModeViewProto:
    return SupportConsentModeViewProto(
        deployment_mode=_consent_to_proto(view.deployment),
        org_override=_consent_to_proto(view.override),
        effective=_consent_to_proto(view.effective),
        locked_by_deployment=view.locked_by_deployment,
    )


_SCOPE_TO_PROTO: dict[SupportSessionScope, int] = {
    SupportSessionScope.READ_ONLY: SupportSessionScopeProto.SUPPORT_SESSION_SCOPE_READ_ONLY,
    SupportSessionScope.READ_WRITE: SupportSessionScopeProto.SUPPORT_SESSION_SCOPE_READ_WRITE,
}

_SCOPE_FROM_PROTO: dict[int, SupportSessionScope] = {
    SupportSessionScopeProto.SUPPORT_SESSION_SCOPE_READ_ONLY: SupportSessionScope.READ_ONLY,
    SupportSessionScopeProto.SUPPORT_SESSION_SCOPE_READ_WRITE: SupportSessionScope.READ_WRITE,
}

_STATE_TO_PROTO: dict[SupportSessionState, int] = {
    SupportSessionState.PENDING: SupportSessionStateProto.SUPPORT_SESSION_STATE_PENDING,
    SupportSessionState.ACTIVE: SupportSessionStateProto.SUPPORT_SESSION_STATE_ACTIVE,
    SupportSessionState.EXPIRED: SupportSessionStateProto.SUPPORT_SESSION_STATE_EXPIRED,
    SupportSessionState.REVOKED: SupportSessionStateProto.SUPPORT_SESSION_STATE_REVOKED,
    SupportSessionState.REJECTED: SupportSessionStateProto.SUPPORT_SESSION_STATE_REJECTED,
}

_STATE_FROM_PROTO: dict[int, SupportSessionState] = {
    SupportSessionStateProto.SUPPORT_SESSION_STATE_PENDING: SupportSessionState.PENDING,
    SupportSessionStateProto.SUPPORT_SESSION_STATE_ACTIVE: SupportSessionState.ACTIVE,
    SupportSessionStateProto.SUPPORT_SESSION_STATE_EXPIRED: SupportSessionState.EXPIRED,
    SupportSessionStateProto.SUPPORT_SESSION_STATE_REVOKED: SupportSessionState.REVOKED,
    SupportSessionStateProto.SUPPORT_SESSION_STATE_REJECTED: SupportSessionState.REJECTED,
}


def scope_from_proto(value: int) -> SupportSessionScope:
    """UNSPECIFIED defaults to READ_ONLY."""
    return _SCOPE_FROM_PROTO.get(value, SupportSessionScope.READ_ONLY)


def state_from_proto(value: int) -> SupportSessionState | None:
    """UNSPECIFIED returns None."""
    return _STATE_FROM_PROTO.get(value)


def _to_timestamp(value: datetime | None) -> Timestamp | None:
    if value is None:
        return None
    ts = Timestamp()
    ts.FromDatetime(value)
    return ts


def session_to_proto(view: SupportSessionView) -> SupportSessionProto:
    msg = SupportSessionProto(
        id=str(view.id),
        organization_id=str(view.organization_id),
        organization_name=view.organization_name,
        organization_slug=view.organization_slug,
        support_user_id=str(view.support_user_id),
        support_user_email=view.support_user_email,
        requested_by_user_id=str(view.requested_by_user_id),
        reason=view.reason,
        scope=_SCOPE_TO_PROTO[view.scope],
        state=_STATE_TO_PROTO[view.state],
    )
    if view.support_user_full_name is not None:
        msg.support_user_full_name = view.support_user_full_name
    if view.granted_by_user_id is not None:
        msg.granted_by_user_id = str(view.granted_by_user_id)
    if view.granted_by_email is not None:
        msg.granted_by_email = view.granted_by_email
    if view.revoked_by_user_id is not None:
        msg.revoked_by_user_id = str(view.revoked_by_user_id)
    if view.revoked_by_email is not None:
        msg.revoked_by_email = view.revoked_by_email

    requested_at = _to_timestamp(view.requested_at)
    if requested_at is not None:
        msg.requested_at.CopyFrom(requested_at)
    if view.granted_at is not None:
        granted_at = _to_timestamp(view.granted_at)
        if granted_at is not None:
            msg.granted_at.CopyFrom(granted_at)
    expires_at = _to_timestamp(view.expires_at)
    if expires_at is not None:
        msg.expires_at.CopyFrom(expires_at)
    if view.revoked_at is not None:
        revoked_at = _to_timestamp(view.revoked_at)
        if revoked_at is not None:
            msg.revoked_at.CopyFrom(revoked_at)
    created_at = _to_timestamp(view.created_at)
    if created_at is not None:
        msg.created_at.CopyFrom(created_at)
    updated_at = _to_timestamp(view.updated_at)
    if updated_at is not None:
        msg.updated_at.CopyFrom(updated_at)
    return msg
