from uniffy_proto.users.v1.users_pb2 import UserProfile

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.login.user import User
from uniffy.domains.users.avatars import get_avatar_url


def user_to_profile(user: User) -> UserProfile:
    return UserProfile(
        id=str(user.id),
        email=user.email,
        full_name=user.full_name or "",
        username=user.username,
        avatar_url=get_avatar_url(user.id, user.avatar_key),
        accent_color=user.accent_color or "",
        font_family=user.font_family or "",
        pronouns=user.pronouns or "",
        is_active=user.is_active,
        is_system_admin=user.is_system_admin,
        created_at=datetime_to_timestamp(user.created_at),
        updated_at=datetime_to_timestamp(user.updated_at),
        has_avatar=user.avatar_key is not None,
    )
