"""Avatar processing utilities for user avatars.

Handles validation, resizing, upload and deletion of user avatar images.
Avatars are stored in S3 as WebP in three sizes: sm (32px), md (64px), lg (128px).
"""

import hashlib
import io
import mimetypes
from uuid import UUID

from loguru import logger
from PIL import Image

from uniffy.core.storage import get_s3_client

AVATAR_SIZES: dict[str, int] = {
    "sm": 32,
    "md": 64,
    "lg": 128,
}

MAX_AVATAR_BYTES = 5 * 1024 * 1024  # 5MB

ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


def validate_avatar_image(data: bytes, filename: str) -> str:
    """
    Validate avatar image data and return detected MIME type.

    Parameters
    ----------
    data : bytes
        Raw image bytes.
    filename : str
        Original filename for MIME type detection.

    Returns
    -------
    str
        Detected MIME type.

    Raises
    ------
    ValueError
        If image is too large, has unsupported type, or is invalid.

    """
    if len(data) > MAX_AVATAR_BYTES:
        raise ValueError(f"Image too large. Maximum size is {MAX_AVATAR_BYTES // (1024 * 1024)}MB")

    mime_type, _ = mimetypes.guess_type(filename)
    if not mime_type or mime_type not in ALLOWED_MIME_TYPES:
        raise ValueError(
            f"Unsupported image type. Allowed: {', '.join(sorted(ALLOWED_MIME_TYPES))}"
        )

    # Verify the image can be opened
    try:
        with Image.open(io.BytesIO(data)) as img:
            img.verify()
    except Exception as e:
        raise ValueError(f"Invalid image file: {e}")

    return mime_type


def resize_avatar(data: bytes, size: int) -> bytes:
    """
    Resize image to a square WebP avatar.

    Crops to center square first, then resizes to target dimensions.

    Parameters
    ----------
    data : bytes
        Raw image bytes.
    size : int
        Target width and height in pixels.

    Returns
    -------
    bytes
        Resized WebP image bytes.

    """
    with Image.open(io.BytesIO(data)) as img:
        # Convert to RGB if necessary (handles RGBA, palette, etc.)
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")

        # Crop to center square
        width, height = img.size
        min_dim = min(width, height)
        left = (width - min_dim) // 2
        top = (height - min_dim) // 2
        img = img.crop((left, top, left + min_dim, top + min_dim))

        # Resize to target size
        img = img.resize((size, size), Image.LANCZOS)

        # Save as WebP
        output = io.BytesIO()
        img.save(output, format="WEBP", quality=85)
        return output.getvalue()


async def upload_avatar(user_id: UUID, image_data: bytes, filename: str) -> str:
    """
    Validate, resize, and upload avatar images to S3.

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
        S3 key prefix (e.g., 'avatars/{user_id}/{hash}').

    Raises
    ------
    ValueError
        If image validation fails.

    """
    validate_avatar_image(image_data, filename)

    # Generate hash from image content for cache busting
    content_hash = hashlib.sha256(image_data).hexdigest()[:8]
    key_prefix = f"avatars/{user_id}/{content_hash}"

    s3 = get_s3_client()

    for size_name, size_px in AVATAR_SIZES.items():
        resized = resize_avatar(image_data, size_px)
        s3_key = f"{key_prefix}/{size_name}.webp"
        await s3.upload_bytes(
            key=s3_key,
            data=resized,
            content_type="image/webp",
        )

    logger.info(f"Uploaded avatar for user {user_id} with key prefix {key_prefix}")
    return key_prefix


async def delete_avatar(avatar_key: str) -> None:
    """
    Delete all avatar sizes from S3.

    Parameters
    ----------
    avatar_key : str
        S3 key prefix for the avatar.

    """
    s3 = get_s3_client()
    keys = [f"{avatar_key}/{size_name}.webp" for size_name in AVATAR_SIZES]
    await s3.delete_objects(keys)
    logger.info(f"Deleted avatar with key prefix {avatar_key}")


def get_avatar_url(user_id: UUID, avatar_key: str | None, size: str = "md") -> str:
    """
    Construct the HTTP URL for an avatar image.

    Includes the content hash from avatar_key as a query parameter for cache busting.
    Each upload produces a new hash, so the URL changes and browsers fetch the new image.

    Parameters
    ----------
    user_id : UUID
        User ID.
    avatar_key : str | None
        S3 key prefix (e.g., 'avatars/{user_id}/{hash}'), or None if no avatar.
    size : str
        Avatar size ('sm', 'md', or 'lg').

    Returns
    -------
    str
        URL path like '/api/avatars/{user_id}/{size}?v={hash}' or empty string if no avatar.

    """
    if not avatar_key:
        return ""
    # Extract hash from avatar_key (format: 'avatars/{user_id}/{hash}')
    content_hash = avatar_key.rsplit("/", 1)[-1]
    return f"/api/avatars/{user_id}/{size}?v={content_hash}"
