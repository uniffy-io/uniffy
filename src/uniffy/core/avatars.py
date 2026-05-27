"""Avatar validation, resizing, S3 upload, and deletion.

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

MAX_AVATAR_BYTES = 5 * 1024 * 1024

ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


def validate_avatar_image(data: bytes, filename: str) -> str:
    """Validate avatar bytes and return the detected MIME type."""
    if len(data) > MAX_AVATAR_BYTES:
        raise ValueError(f"Image too large. Maximum size is {MAX_AVATAR_BYTES // (1024 * 1024)}MB")

    mime_type, _ = mimetypes.guess_type(filename)
    if not mime_type or mime_type not in ALLOWED_MIME_TYPES:
        raise ValueError(f"Unsupported image type. Allowed: {', '.join(sorted(ALLOWED_MIME_TYPES))}")

    try:
        with Image.open(io.BytesIO(data)) as img:
            img.verify()
    except Exception as e:
        raise ValueError(f"Invalid image file: {e}")

    return mime_type


def resize_avatar(data: bytes, size: int) -> bytes:
    """Center-crop to square then resize to a WebP of ``size`` px."""
    with Image.open(io.BytesIO(data)) as img:
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")

        width, height = img.size
        min_dim = min(width, height)
        left = (width - min_dim) // 2
        top = (height - min_dim) // 2
        img = img.crop((left, top, left + min_dim, top + min_dim))

        img = img.resize((size, size), Image.LANCZOS)

        output = io.BytesIO()
        img.save(output, format="WEBP", quality=85)
        return output.getvalue()


async def upload_avatar(
    entity_id: UUID,
    image_data: bytes,
    filename: str,
    prefix: str = "avatars",
) -> str:
    """Validate, resize into three sizes, and upload to S3 under a content-hashed key."""
    validate_avatar_image(image_data, filename)

    content_hash = hashlib.sha256(image_data).hexdigest()[:8]
    key_prefix = f"{prefix}/{entity_id}/{content_hash}"

    s3 = get_s3_client()

    for size_name, size_px in AVATAR_SIZES.items():
        resized = resize_avatar(image_data, size_px)
        s3_key = f"{key_prefix}/{size_name}.webp"
        await s3.upload_bytes(
            key=s3_key,
            data=resized,
            content_type="image/webp",
        )

    logger.info(f"Uploaded avatar for {prefix}/{entity_id} with key prefix {key_prefix}")
    return key_prefix


async def delete_avatar(avatar_key: str) -> None:
    """Delete every size under the avatar key prefix."""
    s3 = get_s3_client()
    keys = [f"{avatar_key}/{size_name}.webp" for size_name in AVATAR_SIZES]
    await s3.delete_objects(keys)
    logger.info(f"Deleted avatar with key prefix {avatar_key}")


def get_avatar_url(
    entity_id: UUID,
    avatar_key: str | None,
    size: str = "md",
    *,
    url_prefix: str = "/api/avatars",
) -> str:
    """Build the HTTP URL for an avatar, with the content hash as a cache-busting query."""
    if not avatar_key:
        return ""
    content_hash = avatar_key.rsplit("/", 1)[-1]
    return f"{url_prefix}/{entity_id}/{size}?v={content_hash}"
