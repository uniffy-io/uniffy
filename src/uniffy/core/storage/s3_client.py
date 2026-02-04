"""
Async S3 client wrapper for file storage.

Provides a high-level interface for S3 operations including:
- Simple uploads/downloads
- Multipart uploads for large files
- Streaming support for ConnectRPC integration
"""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import aioboto3
from loguru import logger
from types_aiobotocore_s3.client import S3Client as S3ClientType

# Default chunk size: 5MB (S3 minimum for multipart)
DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024


@dataclass
class S3Config:
    """S3 configuration from environment variables."""

    endpoint_url: str
    access_key: str
    secret_key: str
    bucket_name: str
    region: str = "us-east-1"
    use_ssl: bool = False

    @classmethod
    def from_env(cls) -> "S3Config":
        """Load S3 configuration from environment variables."""
        return cls(
            endpoint_url=os.getenv("S3_ENDPOINT_URL", "http://localhost:9000"),
            access_key=os.getenv("S3_ACCESS_KEY", "minioadmin"),
            secret_key=os.getenv("S3_SECRET_KEY", "minioadmin"),
            bucket_name=os.getenv("S3_BUCKET_NAME", "uniffy-files"),
            region=os.getenv("S3_REGION", "us-east-1"),
            use_ssl=os.getenv("S3_USE_SSL", "false").lower() == "true",
        )


@dataclass
class MultipartUploadInfo:
    """Information about an in-progress multipart upload."""

    upload_id: str
    bucket: str
    key: str
    parts: list[dict]  # List of {"PartNumber": int, "ETag": str}


class S3Client:
    """
    Async S3 client for file storage operations.

    This client wraps aioboto3 to provide async S3 operations
    with support for streaming uploads/downloads through the backend.

    Parameters
    ----------
    config : S3Config
        S3 configuration.

    """

    def __init__(self, config: S3Config | None = None) -> None:
        """Initialize S3 client with configuration."""
        self.config = config or S3Config.from_env()
        self._session = aioboto3.Session()

    @asynccontextmanager
    async def _get_client(self) -> AsyncIterator[S3ClientType]:
        """Get an S3 client from the session."""
        async with self._session.client(
            "s3",
            endpoint_url=self.config.endpoint_url,
            aws_access_key_id=self.config.access_key,
            aws_secret_access_key=self.config.secret_key,
            region_name=self.config.region,
            use_ssl=self.config.use_ssl,
        ) as client:
            yield client

    async def ensure_bucket_exists(self) -> None:
        """Create the bucket if it doesn't exist."""
        async with self._get_client() as client:
            try:
                await client.head_bucket(Bucket=self.config.bucket_name)
                logger.debug(f"Bucket {self.config.bucket_name} exists")
            except client.exceptions.ClientError:
                logger.info(f"Creating bucket {self.config.bucket_name}")
                await client.create_bucket(Bucket=self.config.bucket_name)

    # ─────────────────────────────────────────────────────────────
    # Simple upload/download (for small files or testing)
    # ─────────────────────────────────────────────────────────────

    async def upload_bytes(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        """
        Upload bytes directly to S3.

        Parameters
        ----------
        key : str
            S3 object key.
        data : bytes
            File content.
        content_type : str
            MIME type of the file.

        Returns
        -------
        str
            The S3 object key.

        """
        async with self._get_client() as client:
            await client.put_object(
                Bucket=self.config.bucket_name,
                Key=key,
                Body=data,
                ContentType=content_type,
            )
        logger.debug(f"Uploaded {len(data)} bytes to {key}")
        return key

    async def download_bytes(self, key: str) -> bytes:
        """
        Download a file from S3 as bytes.

        Parameters
        ----------
        key : str
            S3 object key.

        Returns
        -------
        bytes
            File content.

        """
        async with self._get_client() as client:
            response = await client.get_object(
                Bucket=self.config.bucket_name,
                Key=key,
            )
            async with response["Body"] as stream:
                data = await stream.read()
        logger.debug(f"Downloaded {len(data)} bytes from {key}")
        return data

    # ─────────────────────────────────────────────────────────────
    # Streaming download (for ConnectRPC server streaming)
    # ─────────────────────────────────────────────────────────────

    async def download_stream(
        self,
        key: str,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
    ) -> AsyncIterator[tuple[bytes, int, int]]:
        """
        Stream download a file from S3.

        Yields chunks of data for streaming to client via ConnectRPC.

        Parameters
        ----------
        key : str
            S3 object key.
        chunk_size : int
            Size of each chunk in bytes.

        Yields
        ------
        tuple[bytes, int, int]
            (chunk_data, chunk_number, total_chunks)

        """
        async with self._get_client() as client:
            # Get object metadata first
            head = await client.head_object(
                Bucket=self.config.bucket_name,
                Key=key,
            )
            total_size = head["ContentLength"]
            total_chunks = (total_size + chunk_size - 1) // chunk_size

            # Stream the object
            response = await client.get_object(
                Bucket=self.config.bucket_name,
                Key=key,
            )

            chunk_number = 0
            body = response["Body"]
            # Use iter_chunks for proper async chunked reading
            # (aioboto3's read() doesn't accept size parameter like sync boto3)
            async for chunk in body.iter_chunks(chunk_size=chunk_size):
                chunk_number += 1
                yield chunk, chunk_number, total_chunks

    async def get_object_info(self, key: str) -> dict:
        """
        Get metadata about an S3 object.

        Parameters
        ----------
        key : str
            S3 object key.

        Returns
        -------
        dict
            Object metadata including ContentLength, ContentType, etc.

        """
        async with self._get_client() as client:
            return await client.head_object(
                Bucket=self.config.bucket_name,
                Key=key,
            )

    async def download_range(
        self,
        key: str,
        start_byte: int | None = None,
        end_byte: int | None = None,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
    ) -> AsyncIterator[tuple[bytes, int, int, int]]:
        """
        Download a byte range from S3.

        Supports HTTP Range-like semantics for media streaming.
        If start_byte is None, starts from beginning.
        If end_byte is None, reads to end of file.

        Parameters
        ----------
        key : str
            S3 object key.
        start_byte : int | None
            Start of range (inclusive). Default: 0.
        end_byte : int | None
            End of range (inclusive). Default: end of file.
        chunk_size : int
            Size of each chunk in bytes.

        Yields
        ------
        tuple[bytes, int, int, int]
            (chunk_data, total_size, range_start, range_end)

        """
        async with self._get_client() as client:
            # Get object metadata for total size
            head = await client.head_object(
                Bucket=self.config.bucket_name,
                Key=key,
            )
            total_size = head["ContentLength"]

            # Calculate actual range
            start = start_byte if start_byte is not None else 0
            end = end_byte if end_byte is not None else total_size - 1

            # Clamp values
            start = max(0, min(start, total_size - 1))
            end = max(start, min(end, total_size - 1))

            # Build range header
            range_header = f"bytes={start}-{end}"

            response = await client.get_object(
                Bucket=self.config.bucket_name,
                Key=key,
                Range=range_header,
            )

            body = response["Body"]
            async for chunk in body.iter_chunks(chunk_size=chunk_size):
                yield chunk, total_size, start, end

    # ─────────────────────────────────────────────────────────────
    # Multipart upload (for large files via streaming)
    # ─────────────────────────────────────────────────────────────

    async def create_multipart_upload(
        self,
        key: str,
        content_type: str = "application/octet-stream",
    ) -> str:
        """
        Initiate a multipart upload.

        Parameters
        ----------
        key : str
            S3 object key.
        content_type : str
            MIME type of the file.

        Returns
        -------
        str
            The S3 upload ID.

        """
        async with self._get_client() as client:
            response = await client.create_multipart_upload(
                Bucket=self.config.bucket_name,
                Key=key,
                ContentType=content_type,
            )
        upload_id = response["UploadId"]
        logger.debug(f"Created multipart upload {upload_id} for {key}")
        return upload_id

    async def upload_part(
        self,
        key: str,
        upload_id: str,
        part_number: int,
        data: bytes,
    ) -> str:
        """
        Upload a single part of a multipart upload.

        Parameters
        ----------
        key : str
            S3 object key.
        upload_id : str
            The multipart upload ID.
        part_number : int
            Part number (1-indexed).
        data : bytes
            Part data.

        Returns
        -------
        str
            The ETag of the uploaded part.

        """
        async with self._get_client() as client:
            response = await client.upload_part(
                Bucket=self.config.bucket_name,
                Key=key,
                UploadId=upload_id,
                PartNumber=part_number,
                Body=data,
            )
        etag = response["ETag"]
        logger.debug(f"Uploaded part {part_number} ({len(data)} bytes) for upload {upload_id}")
        return etag

    async def complete_multipart_upload(
        self,
        key: str,
        upload_id: str,
        parts: list[dict],
    ) -> str:
        """
        Complete a multipart upload.

        Parameters
        ----------
        key : str
            S3 object key.
        upload_id : str
            The multipart upload ID.
        parts : list[dict]
            List of parts with {"PartNumber": int, "ETag": str}.

        Returns
        -------
        str
            The ETag of the completed object.

        """
        # Sort parts by part number
        sorted_parts = sorted(parts, key=lambda p: p["PartNumber"])

        async with self._get_client() as client:
            response = await client.complete_multipart_upload(
                Bucket=self.config.bucket_name,
                Key=key,
                UploadId=upload_id,
                MultipartUpload={"Parts": sorted_parts},
            )
        etag = response.get("ETag", "")
        logger.info(f"Completed multipart upload {upload_id} for {key}")
        return etag

    async def abort_multipart_upload(
        self,
        key: str,
        upload_id: str,
    ) -> None:
        """
        Abort a multipart upload.

        Parameters
        ----------
        key : str
            S3 object key.
        upload_id : str
            The multipart upload ID.

        """
        async with self._get_client() as client:
            await client.abort_multipart_upload(
                Bucket=self.config.bucket_name,
                Key=key,
                UploadId=upload_id,
            )
        logger.info(f"Aborted multipart upload {upload_id} for {key}")

    async def list_multipart_parts(
        self,
        key: str,
        upload_id: str,
    ) -> list[dict]:
        """
        List uploaded parts for a multipart upload.

        Parameters
        ----------
        key : str
            S3 object key.
        upload_id : str
            The multipart upload ID.

        Returns
        -------
        list[dict]
            List of uploaded parts with PartNumber, ETag, Size.

        """
        async with self._get_client() as client:
            response = await client.list_parts(
                Bucket=self.config.bucket_name,
                Key=key,
                UploadId=upload_id,
            )
        return response.get("Parts", [])

    # ─────────────────────────────────────────────────────────────
    # Delete operations
    # ─────────────────────────────────────────────────────────────

    async def delete_object(self, key: str) -> None:
        """
        Delete an object from S3.

        Parameters
        ----------
        key : str
            S3 object key.

        """
        async with self._get_client() as client:
            await client.delete_object(
                Bucket=self.config.bucket_name,
                Key=key,
            )
        logger.debug(f"Deleted object {key}")

    async def delete_objects(self, keys: list[str]) -> None:
        """
        Delete multiple objects from S3.

        Parameters
        ----------
        keys : list[str]
            List of S3 object keys.

        """
        if not keys:
            return

        async with self._get_client() as client:
            await client.delete_objects(
                Bucket=self.config.bucket_name,
                Delete={"Objects": [{"Key": k} for k in keys]},
            )
        logger.debug(f"Deleted {len(keys)} objects")

    async def object_exists(self, key: str) -> bool:
        """
        Check if an object exists in S3.

        Parameters
        ----------
        key : str
            S3 object key.

        Returns
        -------
        bool
            True if object exists.

        """
        async with self._get_client() as client:
            try:
                await client.head_object(
                    Bucket=self.config.bucket_name,
                    Key=key,
                )
                return True
            except client.exceptions.ClientError:
                return False

    async def generate_presigned_url(
        self,
        key: str,
        expires_in: int = 3600,
        content_type: str | None = None,
    ) -> str:
        """
        Generate a presigned URL for accessing an S3 object.

        Parameters
        ----------
        key : str
            S3 object key.
        expires_in : int
            URL expiration time in seconds (default: 1 hour).
        content_type : str | None
            Optional content type for response.

        Returns
        -------
        str
            Presigned URL for accessing the object.

        """
        async with self._get_client() as client:
            params = {
                "Bucket": self.config.bucket_name,
                "Key": key,
            }
            if content_type:
                params["ResponseContentType"] = content_type

            url = await client.generate_presigned_url(
                "get_object",
                Params=params,
                ExpiresIn=expires_in,
            )
        return url


# Global S3 client instance
_s3_client: S3Client | None = None


def get_s3_client() -> S3Client:
    """Get the global S3 client instance."""
    global _s3_client
    if _s3_client is None:
        _s3_client = S3Client()
    return _s3_client


async def init_s3() -> None:
    """Initialize S3 client and ensure bucket exists."""
    client = get_s3_client()
    await client.ensure_bucket_exists()
    logger.info("S3 storage initialized")


async def close_s3() -> None:
    """Close S3 client (cleanup)."""
    global _s3_client
    _s3_client = None
    logger.info("S3 storage closed")
