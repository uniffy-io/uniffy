"""Proto <-> domain converters for auth domain."""

from uuid import UUID

from uniffy_proto.auth.v1.auth_pb import GetCurrentUserResponse, SessionInfo

from uniffy.core.avatars import get_avatar_url
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession


def user_to_current_user_response(user: User) -> GetCurrentUserResponse:
    return GetCurrentUserResponse(
        id=str(user.id),
        email=user.email,
        username=user.username,
        full_name=user.full_name or "",
        is_active=user.is_active,
        is_system_admin=user.is_system_admin,
        email_verified=user.email_verified,
        accent_color=user.accent_color or "",
        font_family=user.font_family or "",
        pronouns=user.pronouns or "",
        avatar_url=get_avatar_url(user.id, user.avatar_key),
        has_avatar=user.avatar_key is not None,
    )


def session_to_proto(
    session: UserSession,
    current_session_id: UUID | None = None,
) -> SessionInfo:
    """
    Convert UserSession model to SessionInfo proto.

    Parameters
    ----------
    session : UserSession
        UserSession model instance.
    current_session_id : UUID | None
        The caller's current session ID, used to set the is_current flag.

    Returns
    -------
    SessionInfo
        Proto message.

    """
    return SessionInfo(
        id=str(session.id),
        user_agent=session.user_agent,
        device_label=session.device_label,
        created_at=session.created_at.isoformat(),
        last_activity=session.last_activity.isoformat(),
        is_current=current_session_id is not None and session.id == current_session_id,
    )


user_to_proto = user_to_current_user_response
