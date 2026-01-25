"""Proto <-> domain converters for groups domain."""

from uwos.core.converters import (
    datetime_to_timestamp,
    group_info_to_proto,
    group_member_info_to_proto,
    group_role_to_proto,
)
from uwos.core.models.login.group import Group


def group_with_count_to_proto(group: Group, member_count: int):
    """
    Convert Group with member count to GroupInfo proto.

    Parameters
    ----------
    group : Group
        Group model instance.
    member_count : int
        Number of members.

    Returns
    -------
    GroupInfo
        Proto message.

    """
    proto = group_info_to_proto(group)
    proto.member_count = member_count
    return proto


# Re-export from core converters for convenience
__all__ = [
    "group_with_count_to_proto",
    "group_info_to_proto",
    "group_member_info_to_proto",
    "group_role_to_proto",
    "datetime_to_timestamp",
]
