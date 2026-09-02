"""Proto <-> domain converters for groups domain."""

from uniffy.core.converters import (
    datetime_to_timestamp,
    group_info_to_proto,
    group_member_info_to_proto,
    group_role_to_proto,
)
from uniffy.core.models.login.group import Group


def group_with_count_to_proto(group: Group, member_count: int):
    proto = group_info_to_proto(group)
    proto.member_count = member_count
    return proto


__all__ = [
    "group_with_count_to_proto",
    "group_info_to_proto",
    "group_member_info_to_proto",
    "group_role_to_proto",
    "datetime_to_timestamp",
]
