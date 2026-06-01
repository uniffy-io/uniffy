"""Download a file, extract its text, persist to FileMediaInfo, and re-index it."""

from typing import Any
from uuid import UUID

from arq import Retry
from loguru import logger
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import selectinload

from uniffy.core.auth.permissions.defaults import (
    resolve_content_defaults,
    resolve_effective_policy,
)
from uniffy.core.extraction import UnsupportedFormatError, extract_text
from uniffy.core.models.files.file import ExtractionStatus, File
from uniffy.core.models.files.media_info import FileMediaInfo
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.storage.s3_client import get_s3_client
from uniffy.core.types import ContentType
from uniffy.core.valkey import publish_notification
from uniffy.db.session import open_session
from uniffy.domains.tags import TagOperations

logger = logger.bind(component="tasks.content_extraction")

_task = "content_extraction"

_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024


async def extract_document_content(
    ctx: dict[str, Any],
    file_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """Extract text content from a document file and re-index it for search."""
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

        if file.extraction_status != ExtractionStatus.COMPLETED:
            file.extraction_status = ExtractionStatus.PROCESSING
            await session.commit()

        mime_type = file.mime_type or ""

        try:
            data = await s3.download_bytes(file.storage_key)
            log.info("Downloaded file", bytes=len(data))

            if len(data) > _MAX_DOWNLOAD_BYTES:
                data = data[:_MAX_DOWNLOAD_BYTES]

            result = extract_text(data, mime_type)
            log.info(
                "Extracted text",
                chars=len(result.text),
                page_count=result.page_count,
                word_count=result.word_count,
                truncated=result.truncated,
            )

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

            await _reindex_file(session, file, result.text)

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


async def _reindex_file(session: Any, file: File, extracted_text: str) -> None:
    """Re-index the file in Meilisearch with extracted text added to the keywords."""
    try:
        urn = build_content_urn(ContentType.FILE, file.id)
        parts = [file.filename, file.original_filename]
        if file.description:
            parts.append(file.description)
        if file.mime_type:
            parts.append(file.mime_type)
        if extracted_text:
            parts.append(extracted_text)

        keywords = " ".join(filter(None, parts))

        tag_ops = TagOperations(session)
        tags_by_urn = await tag_ops.get_for_urns(
            organization_id=file.organization_id,
            content_urns=[urn],
        )
        tag_slugs = sorted({t.slug for t in tags_by_urn.get(urn, [])}) or None

        # Fall back to an extracted snippet so mention previews show file content.
        description = file.description or (extracted_text[:300].strip() if extracted_text else None)

        default_mode, default_baseline = await resolve_content_defaults(
            session, file.organization_id, ContentType.FILE,
        )
        effective_mode, effective_baseline = resolve_effective_policy(
            file.access_mode, file.baseline_role, default_mode, default_baseline,
        )

        indexer = SearchIndexer()
        await indexer.index(
            urn=urn,
            organization_id=file.organization_id,
            title=file.filename,
            entity_type=ContentType.FILE.value,
            url_path=f"/files/{file.id}",
            access_mode=effective_mode.value,
            baseline_role=(
                effective_baseline.value if effective_baseline is not None else None
            ),
            owner_id=file.owner_id,
            keywords=keywords,
            description=description,
            tags=tag_slugs,
        )
    except Exception:
        logger.warning("Failed to re-index file after extraction", file_id=str(file.id))
