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

# Re-export shared constants and functions
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


async def upload_avatar(user_id: UUID, image_data: bytes, filename: str) -> str:
    """Validate, resize, and upload user avatar images to S3.

    Creates three sizes (sm, md, lg) stored under a hash-based key for cache busting.

    Parameters
    ----------
    user_id : UUID
        User ID.
    image_data : bytes
        Raw image bytes.
    filename : str
        Original filename for MIME type detection.

    Returns
    -------
    str
        S3 key prefix (e.g. 'avatars/{user_id}/{hash}').

    Raises
    ------
    ValueError
        If image validation fails.

    """
    return await _core_upload_avatar(user_id, image_data, filename, prefix="avatars")
