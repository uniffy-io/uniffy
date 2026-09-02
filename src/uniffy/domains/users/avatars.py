"""Avatar processing utilities for user avatars.

Thin wrapper around core.avatars that provides user-specific defaults.
Avatars are stored in S3 as WebP in three sizes: sm (32px), md (64px), lg (128px).
"""

from uuid import UUID

from uniffy.core.avatars import (
    ALLOWED_MIME_TYPES,
    AVATAR_SIZES,
    MAX_AVATAR_BYTES,
    delete_avatar,
    get_avatar_url,
    resize_avatar,
    validate_avatar_image,
)
from uniffy.core.avatars import (
    upload_avatar as _core_upload_avatar,
)
from uniffy.core.storage import ObjectStorage

__all__ = [
    "ALLOWED_MIME_TYPES",
    "AVATAR_SIZES",
    "MAX_AVATAR_BYTES",
    "delete_avatar",
    "get_avatar_url",
    "resize_avatar",
    "validate_avatar_image",
    "upload_avatar",
]


async def upload_avatar(
    storage: ObjectStorage,
    user_id: UUID,
    image_data: bytes,
    filename: str,
) -> str:
    return await _core_upload_avatar(storage, user_id, image_data, filename, prefix="avatars")
