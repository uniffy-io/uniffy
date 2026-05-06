"""Document content extraction task.

Downloads files from S3 and extracts text content using the shared
extraction module. UPSERTs extracted_text into FileMediaInfo and
re-indexes the file in search.
"""

from typing import Any
from uuid import UUID

from arq import Retry
from loguru import logger
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import selectinload

from uniffy.core.extraction import UnsupportedFormatError, extract_text
from uniffy.core.models.files.file import ExtractionStatus, File
from uniffy.core.models.files.media_info import FileMediaInfo
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.storage.s3_client import get_s3_client
from uniffy.core.types import ContentType
from uniffy.core.valkey import publish_notification
from uniffy.db.session import open_session

_task = "content_extraction"

# Maximum bytes to download for extraction (50 MB)
_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024


async def extract_document_content(
    ctx: dict[str, Any],
    file_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """Extract text content from a document file.

    Downloads the file from S3, extracts text using the shared extraction
    module, stores the result in FileMediaInfo, and re-indexes the file
    in Meilisearch with the extracted content.

    Parameters
    ----------
    ctx : dict
        ARQ context with shared resources and job metadata.
    file_id : str
        File UUID as string.
    organization_id : str
        Organization UUID as string.

    Returns
    -------
    dict
        Result with status and extraction metadata.

    """
    log = logger.bind(task=_task, file_id=file_id)
    log.info("Started")

    file_uuid = UUID(file_id)
    s3 = get_s3_client()

    async with open_session() as session:
        file = await session.get(
            File,
            file_uuid,
            options=[selectinload(File.media_info)],
        )
        if not file:
            log.warning("File not found")
            return {"status": "not_found", "file_id": file_id}

        # Update status to PROCESSING if not already completed
        if file.extraction_status != ExtractionStatus.COMPLETED:
            file.extraction_status = ExtractionStatus.PROCESSING
            await session.commit()

        mime_type = file.mime_type or ""

        try:
            # Download file from S3
            data = await s3.download_bytes(file.storage_key)
            log.info("Downloaded file", bytes=len(data))

            if len(data) > _MAX_DOWNLOAD_BYTES:
                data = data[:_MAX_DOWNLOAD_BYTES]

            # Extract text using shared module
            result = extract_text(data, mime_type)
            log.info(
                "Extracted text",
                chars=len(result.text),
                page_count=result.page_count,
                word_count=result.word_count,
                truncated=result.truncated,
            )

            # UPSERT extracted_text (and page_count if available) into FileMediaInfo
            upsert_values: dict[str, Any] = {
                "file_id": file_uuid,
                "extracted_text": result.text,
            }
            update_set: dict[str, Any] = {
                "extracted_text": pg_insert(FileMediaInfo).excluded.extracted_text,
            }

            if result.page_count is not None:
                upsert_values["page_count"] = result.page_count
                update_set["page_count"] = pg_insert(FileMediaInfo).excluded.page_count

            stmt = pg_insert(FileMediaInfo).values(**upsert_values)
            stmt = stmt.on_conflict_do_update(
                index_elements=["file_id"],
                set_=update_set,
            )
            await session.execute(stmt)

            file.extraction_status = ExtractionStatus.COMPLETED
            await session.commit()

            # Re-index in Meilisearch with extracted text
            await _reindex_file(file, result.text)

            # Notify frontend
            try:
                await publish_notification(
                    file.owner_id,
                    {
                        "_type": "file_updated",
                        "file_id": str(file.id),
                        "organization_id": str(file.organization_id),
                    },
                )
            except Exception:
                log.warning("Failed to publish file update event")

            log.info("Done")
            return {
                "status": "success",
                "chars": len(result.text),
                "page_count": result.page_count,
                "word_count": result.word_count,
            }

        except UnsupportedFormatError:
            log.info("Unsupported format, skipping", mime_type=mime_type)
            file.extraction_status = ExtractionStatus.SKIPPED
            await session.commit()
            return {"status": "skipped", "file_id": file_id}

        except Exception as e:
            log.error("Failed", error=str(e))

            job_try = ctx.get("job_try", 1)
            if job_try < 3:
                raise Retry(defer=job_try * 10)

            # Mark as failed after max retries
            file.extraction_status = ExtractionStatus.FAILED
            error_stmt = pg_insert(FileMediaInfo).values(
                file_id=file_uuid,
                extraction_error=str(e)[:2000],
            )
            error_stmt = error_stmt.on_conflict_do_update(
                index_elements=["file_id"],
                set_={"extraction_error": error_stmt.excluded.extraction_error},
            )
            await session.execute(error_stmt)
            await session.commit()

            return {"status": "failed", "error": str(e)}


async def _reindex_file(file: File, extracted_text: str) -> None:
    """Re-index the file in Meilisearch with extracted text content.

    Parameters
    ----------
    file : File
        The file model to re-index.
    extracted_text : str
        Extracted text to include in search keywords.

    """
    try:
        urn = build_content_urn(ContentType.FILE, file.id)
        parts = [file.filename, file.original_filename]
        if file.tags:
            parts.extend(f"tag:{tag}" for tag in file.tags)
        if file.description:
            parts.append(file.description)
        if file.mime_type:
            parts.append(file.mime_type)
        if extracted_text:
            parts.append(extracted_text)

        keywords = " ".join(filter(None, parts))

        # Surface a snippet of the extracted text as the description when the
        # user did not write one. Mention previews render the description, so
        # this gives users a peek at the file contents (CSV header row, first
        # paragraph of a doc, etc) without opening the viewer.
        description = file.description or (extracted_text[:300].strip() if extracted_text else None)

        indexer = SearchIndexer()
        await indexer.index(
            urn=urn,
            organization_id=file.organization_id,
            title=file.filename,
            entity_type=ContentType.FILE.value,
            url_path=f"/files/{file.id}",
            access_mode=file.access_mode.value,
            baseline_role=(file.baseline_role.value if file.baseline_role is not None else None),
            owner_id=file.owner_id,
            keywords=keywords,
            description=description,
        )
    except Exception:
        logger.warning("Failed to re-index file after extraction", file_id=str(file.id))
