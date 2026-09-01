"""Search projection for file rows."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.domains.tags.reader import TagReader


class FileSearchOperations(BaseContentOperations[File]):
    content_type = ContentType.FILE
    model_class = File

    def _build_search_keywords(self, model: File) -> str:
        parts = [model.filename, model.original_filename]
        if model.description:
            parts.append(model.description)
        if model.mime_type:
            parts.append(model.mime_type)
        if model.media_info and model.media_info.extracted_text:
            parts.append(model.media_info.extracted_text)
        return " ".join(filter(None, parts))

    def _get_search_title(self, model: File) -> str:
        return model.filename

    def _get_url_path(self, model: File) -> str:
        return f"/files/{model.id}"

    def _get_search_description(self, model: File) -> str | None:
        if model.description:
            return model.description
        if model.media_info and model.media_info.extracted_text:
            return model.media_info.extracted_text[:300].strip() or None
        return None

    async def _get_search_tags_async(self, model: File) -> list[str] | None:
        urn = build_content_urn(self.content_type, model.id)
        bulk = await TagReader(self.session).get_for_urns(
            organization_id=model.organization_id,
            content_urns=[urn],
        )
        slugs = sorted({tag.slug for tag in bulk.get(urn, [])})
        return slugs or None

    def _get_search_metadata(self, model: File) -> dict[str, str] | None:
        metadata: dict[str, str] = {}
        if model.mime_type:
            metadata["mime_type"] = model.mime_type
        if model.folder_id:
            metadata["folder_id"] = str(model.folder_id)
        return metadata or None

    async def _get_search_metadata_async(self, model: File) -> dict[str, str] | None:
        metadata = dict(self._get_search_metadata(model) or {})
        if model.folder_id:
            result = await self.session.execute(
                select(Folder.name).where(Folder.id == model.folder_id)
            )
            name = result.scalar_one_or_none()
            if name:
                metadata["parent_label"] = name
        return metadata or None

    async def _fetch_by_id(
        self,
        content_id: UUID,
        organization_id: UUID,
    ) -> File | None:
        result = await self.session.execute(
            select(File)
            .where(File.id == content_id)
            .where(File.organization_id == organization_id)
            .options(selectinload(File.media_info))
        )
        return result.scalar_one_or_none()
