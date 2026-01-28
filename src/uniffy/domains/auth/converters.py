"""Proto <-> domain converters for auth domain."""

from uniffy.core.models.login.user import User
from uniffy.gen.auth.v1.auth_pb2 import CurrentUserResponse


def user_to_current_user_response(user: User) -> CurrentUserResponse:
    """
    Convert User model to CurrentUserResponse proto.

    Parameters
    ----------
    user : User
        User model instance.

    Returns
    -------
    CurrentUserResponse
        Proto message.

    """
    return CurrentUserResponse(
        id=str(user.id),
        email=user.email,
        username=user.username,
        full_name=user.full_name or "",
        is_active=user.is_active,
        is_system_admin=user.is_system_admin,
        email_verified=user.email_verified,
        accent_color=user.accent_color or "",
        font_family=user.font_family or "",
        avatar_url="",  # TODO: Add avatar_url to User model
    )


# Backward compatibility alias
user_to_proto = user_to_current_user_response
