"""Storage module for S3-compatible object storage."""

from uniffy.core.storage.s3_client import S3Client, get_s3_client

__all__ = ["S3Client", "get_s3_client"]
