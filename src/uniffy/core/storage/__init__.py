"""Vendor-neutral object-storage contract."""

from collections.abc import AsyncIterator
from typing import Any, Protocol

DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024
OBJECT_STORAGE_CTX_KEY = "object_storage"


class ObjectStorage(Protocol):
    @property
    def bucket_name(self) -> str: ...

    async def startup(self) -> None: ...

    async def shutdown(self) -> None: ...

    async def ensure_bucket_exists(self) -> None: ...

    async def upload_bytes(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str: ...

    async def download_bytes(self, key: str) -> bytes: ...

    def download_stream(
        self,
        key: str,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
    ) -> AsyncIterator[tuple[bytes, int, int]]: ...

    async def get_object_info(self, key: str) -> dict[str, Any]: ...

    def download_range(
        self,
        key: str,
        start_byte: int | None = None,
        end_byte: int | None = None,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
    ) -> AsyncIterator[tuple[bytes, int, int, int]]: ...

    async def create_multipart_upload(
        self,
        key: str,
        content_type: str = "application/octet-stream",
    ) -> str: ...

    async def upload_part(
        self,
        key: str,
        upload_id: str,
        part_number: int,
        data: bytes,
    ) -> str: ...

    async def complete_multipart_upload(
        self,
        key: str,
        upload_id: str,
        parts: list[dict[str, Any]],
    ) -> str: ...

    async def abort_multipart_upload(self, key: str, upload_id: str) -> None: ...

    async def list_multipart_parts(
        self,
        key: str,
        upload_id: str,
    ) -> list[dict[str, Any]]: ...

    async def copy_object(
        self,
        source_key: str,
        destination_key: str,
        content_type: str | None = None,
    ) -> str: ...

    async def delete_object(self, key: str) -> None: ...

    async def delete_objects(self, keys: list[str]) -> None: ...

    async def object_exists(self, key: str) -> bool: ...

    async def generate_presigned_url(
        self,
        key: str,
        expires_in: int = 3600,
        content_type: str | None = None,
    ) -> str: ...


__all__ = [
    "DEFAULT_CHUNK_SIZE",
    "OBJECT_STORAGE_CTX_KEY",
    "ObjectStorage",
]
