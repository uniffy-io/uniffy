"""
Converters module for proto/model transformations.

Provides utilities for converting between protobuf types
and domain types.
"""

from uwos.core.converters.common_proto import (
    CONTENT_TYPE_FROM_PROTO,
    CONTENT_TYPE_TO_PROTO,
    GROUP_ROLE_FROM_PROTO,
    GROUP_ROLE_TO_PROTO,
    ORG_ROLE_FROM_PROTO,
    ORG_ROLE_TO_PROTO,
    PERMISSION_LEVEL_FROM_PROTO,
    PERMISSION_LEVEL_TO_PROTO,
    SUBJECT_TYPE_FROM_PROTO,
    SUBJECT_TYPE_TO_PROTO,
    VISIBILITY_FROM_PROTO,
    VISIBILITY_TO_PROTO,
    content_type_from_proto,
    content_type_to_proto,
    group_info_to_proto,
    group_member_info_to_proto,
    group_role_from_proto,
    group_role_to_proto,
    member_info_to_proto,
    org_info_to_proto,
    org_role_from_proto,
    org_role_to_proto,
    permission_level_from_proto,
    permission_level_to_proto,
    subject_type_from_proto,
    subject_type_to_proto,
    timestamp_to_proto,
    user_info_to_proto,
    visibility_from_proto,
    visibility_to_proto,
)
from uwos.core.converters.proto import (
    datetime_to_timestamp,
    optional_timestamp,
    timestamp_to_datetime,
)

__all__ = [
    # Proto utilities
    "datetime_to_timestamp",
    "optional_timestamp",
    "timestamp_to_datetime",
    "timestamp_to_proto",
    # Enum mappings
    "CONTENT_TYPE_TO_PROTO",
    "CONTENT_TYPE_FROM_PROTO",
    "SUBJECT_TYPE_TO_PROTO",
    "SUBJECT_TYPE_FROM_PROTO",
    "PERMISSION_LEVEL_TO_PROTO",
    "PERMISSION_LEVEL_FROM_PROTO",
    "VISIBILITY_TO_PROTO",
    "VISIBILITY_FROM_PROTO",
    "ORG_ROLE_TO_PROTO",
    "ORG_ROLE_FROM_PROTO",
    "GROUP_ROLE_TO_PROTO",
    "GROUP_ROLE_FROM_PROTO",
    # Enum converter functions
    "content_type_to_proto",
    "content_type_from_proto",
    "subject_type_to_proto",
    "subject_type_from_proto",
    "permission_level_to_proto",
    "permission_level_from_proto",
    "visibility_to_proto",
    "visibility_from_proto",
    "org_role_to_proto",
    "org_role_from_proto",
    "group_role_to_proto",
    "group_role_from_proto",
    # Message converter functions
    "user_info_to_proto",
    "org_info_to_proto",
    "group_info_to_proto",
    "member_info_to_proto",
    "group_member_info_to_proto",
]
