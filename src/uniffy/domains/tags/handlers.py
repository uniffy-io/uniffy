from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.tags.v1.tags_pb2 import (
    AssignTagsRequest,
    AssignTagsResponse,
    CreateTagRequest,
    CreateTagResponse,
    DeleteTagRequest,
    DeleteTagResponse,
    GetTagRequest,
    GetTagResponse,
    GetTagsForUrnsRequest,
    GetTagsForUrnsResponse,
    ListContentByTagRequest,
    ListContentByTagResponse,
    ListTagsRequest,
    ListTagsResponse,
    MergeTagsRequest,
    MergeTagsResponse,
    SuggestTagsRequest,
    SuggestTagsResponse,
    UnassignTagsRequest,
    UnassignTagsResponse,
    UpdateTagRequest,
    UpdateTagResponse,
    UrnTags,
)

from uniffy.core.auth.principal import (
    current_user_id,
    resolve_organization_id,
)
from uniffy.core.content.references import parse_urn
from uniffy.core.converters.common_proto import (
    content_type_from_proto,
    content_type_to_proto,
)
from uniffy.core.errors import (
    ConflictError,
    NotFoundError,
    UNIFFYError,
    ValidationError,
)
from uniffy.core.jobs import enqueue_job_reconnecting
from uniffy.core.types import ContentType
from uniffy.domains.tags.converters import (
    assignment_to_proto,
    sort_from_proto,
    source_from_proto,
    tag_to_proto,
    tagged_content_item_to_proto,
    tags_to_proto_list,
)
from uniffy.domains.tags.filters.converters import criteria_from_proto
from uniffy.domains.tags.jobs.contracts import REINDEX_TAG_URNS
from uniffy.domains.tags.operations import (
    SOURCE_MANUAL,
    TagLimitExceededError,
    TagOperations,
    TagSlugCollisionError,
)
from uniffy.domains.tags.targets import TagTargetAccess
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="tags.handlers")


def _parse_uuid(value: str, field: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}") from exc


def _content_types_from_proto(values: list[int]) -> list[ContentType]:
    out: list[ContentType] = []
    for value in values:
        ct = content_type_from_proto(value)
        if ct is not None:
            out.append(ct)
    return out


def _domain_error_to_connect(exc: Exception) -> ConnectError:
    if isinstance(exc, TagSlugCollisionError):
        return ConnectError(Code.ALREADY_EXISTS, str(exc))
    if isinstance(exc, ConflictError):
        return ConnectError(Code.ALREADY_EXISTS, str(exc))
    if isinstance(exc, TagLimitExceededError):
        return ConnectError(Code.FAILED_PRECONDITION, str(exc))
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc))
    if isinstance(exc, UNIFFYError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    return ConnectError(Code.INTERNAL, "Internal server error")


class TagsHandlers:
    async def create_tag(
        self,
        request: CreateTagRequest,
        ctx: RequestContext,
    ) -> CreateTagResponse:
        actor_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        if not request.name or not request.name.strip():
            raise ConnectError(Code.INVALID_ARGUMENT, "name is required")

        try:
            async with open_session() as session:
                ops = TagOperations(session, self.search_indexer)
                tag = await ops.create(
                    actor_id=actor_id,
                    organization_id=organization_id,
                    name=request.name,
                    color=request.color or None,
                    description=request.description or None,
                )
                count = await ops._get_usage_count(organization_id, tag.id)
            return CreateTagResponse(tag=tag_to_proto(tag, usage_count=count))
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"create_tag failed: {exc}")
            raise _domain_error_to_connect(exc)

    async def update_tag(
        self,
        request: UpdateTagRequest,
        ctx: RequestContext,
    ) -> UpdateTagResponse:
        actor_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        tag_id = _parse_uuid(request.tag_id, "tag_id")

        try:
            async with open_session() as session:
                ops = TagOperations(session, self.search_indexer)
                tag, slug_changed = await ops.update(
                    actor_id=actor_id,
                    organization_id=organization_id,
                    tag_id=tag_id,
                    name=request.name if request.HasField("name") else None,
                    color=request.color if request.HasField("color") else None,
                    description=(request.description if request.HasField("description") else None),
                )
                affected_urns: list[str] = []
                if slug_changed:
                    affected_urns = await ops.list_assigned_urns_for_tag(tag.id)
                count = await ops._get_usage_count(organization_id, tag.id)

            if affected_urns:
                try:
                    await enqueue_job_reconnecting(
                        REINDEX_TAG_URNS,
                        str(organization_id),
                        affected_urns,
                    )
                except Exception:
                    logger.warning("Failed to enqueue reindex_tag_urns after rename")
            return UpdateTagResponse(tag=tag_to_proto(tag, usage_count=count))
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"update_tag failed: {exc}")
            raise _domain_error_to_connect(exc)

    async def delete_tag(
        self,
        request: DeleteTagRequest,
        ctx: RequestContext,
    ) -> DeleteTagResponse:
        actor_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        tag_id = _parse_uuid(request.tag_id, "tag_id")

        try:
            async with open_session() as session:
                ops = TagOperations(session, self.search_indexer)
                affected_urns = await ops.delete(
                    actor_id=actor_id,
                    organization_id=organization_id,
                    tag_id=tag_id,
                )
            if affected_urns:
                try:
                    await enqueue_job_reconnecting(
                        REINDEX_TAG_URNS,
                        str(organization_id),
                        affected_urns,
                    )
                except Exception:
                    logger.warning("Failed to enqueue reindex_tag_urns after tag delete")
            return DeleteTagResponse(success=True)
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"delete_tag failed: {exc}")
            raise _domain_error_to_connect(exc)

    async def get_tag(
        self,
        request: GetTagRequest,
        ctx: RequestContext,
    ) -> GetTagResponse:
        actor_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        if not request.tag:
            raise ConnectError(Code.INVALID_ARGUMENT, "tag is required")

        try:
            async with open_session() as session:
                ops = TagOperations(session, self.search_indexer)
                tag = await ops.get(
                    organization_id=organization_id,
                    tag_or_slug=request.tag,
                    actor_id=actor_id,
                )
                count = await ops._get_usage_count(organization_id, tag.id)
            return GetTagResponse(tag=tag_to_proto(tag, usage_count=count))
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"get_tag failed: {exc}")
            raise _domain_error_to_connect(exc)

    async def list_tags(
        self,
        request: ListTagsRequest,
        ctx: RequestContext,
    ) -> ListTagsResponse:
        actor_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                ops = TagOperations(session, self.search_indexer)
                tags, counts, next_token = await ops.list_tags(
                    organization_id=organization_id,
                    content_types=_content_types_from_proto(list(request.content_types)),
                    query=request.query or None,
                    sort=sort_from_proto(request.sort),
                    page_size=request.page_size or 100,
                    page_token=request.page_token or None,
                    actor_id=actor_id,
                )
            return ListTagsResponse(
                tags=tags_to_proto_list(tags, counts),
                next_page_token=next_token or "",
            )
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"list_tags failed: {exc}")
            raise _domain_error_to_connect(exc)

    async def suggest_tags(
        self,
        request: SuggestTagsRequest,
        ctx: RequestContext,
    ) -> SuggestTagsResponse:
        actor_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                ops = TagOperations(session, self.search_indexer)
                tags = await ops.suggest(
                    organization_id=organization_id,
                    prefix=request.prefix,
                    limit=request.limit or 10,
                    actor_id=actor_id,
                )
                counts = await ops._get_usage_counts(organization_id, [t.id for t in tags])
            return SuggestTagsResponse(tags=tags_to_proto_list(tags, counts))
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"suggest_tags failed: {exc}")
            raise _domain_error_to_connect(exc)

    async def assign_tags(
        self,
        request: AssignTagsRequest,
        ctx: RequestContext,
    ) -> AssignTagsResponse:
        actor_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        if not request.content_urn:
            raise ConnectError(Code.INVALID_ARGUMENT, "content_urn is required")

        tag_ids = [_parse_uuid(tid, "tag_id") for tid in request.tag_ids]
        source = source_from_proto(request.source) or SOURCE_MANUAL

        try:
            async with open_session() as session:
                ops = TagOperations(session, self.search_indexer)
                target = parse_urn(request.content_urn)
                if target is None:
                    raise ValidationError("content_urn", "Invalid content URN")
                await TagTargetAccess(session).require_edit(
                    actor_id,
                    organization_id,
                    *target,
                )
                assignments = await ops.assign(
                    actor_id=actor_id,
                    organization_id=organization_id,
                    content_urn=request.content_urn,
                    tag_ids=tag_ids,
                    source=source,
                )
            return AssignTagsResponse(assignments=[assignment_to_proto(a) for a in assignments])
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"assign_tags failed: {exc}")
            raise _domain_error_to_connect(exc)

    async def unassign_tags(
        self,
        request: UnassignTagsRequest,
        ctx: RequestContext,
    ) -> UnassignTagsResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        if not request.content_urn:
            raise ConnectError(Code.INVALID_ARGUMENT, "content_urn is required")

        tag_ids = (
            [_parse_uuid(tid, "tag_id") for tid in request.tag_ids] if request.tag_ids else None
        )
        source = source_from_proto(request.source)

        try:
            async with open_session() as session:
                ops = TagOperations(session, self.search_indexer)
                target = parse_urn(request.content_urn)
                if target is None:
                    raise ValidationError("content_urn", "Invalid content URN")
                await TagTargetAccess(session).require_edit(
                    user_id,
                    organization_id,
                    *target,
                )
                await ops.unassign(
                    actor_id=user_id,
                    organization_id=organization_id,
                    content_urn=request.content_urn,
                    tag_ids=tag_ids,
                    source=source,
                )
            return UnassignTagsResponse(success=True)
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"unassign_tags failed: {exc}")
            raise _domain_error_to_connect(exc)

    async def get_tags_for_urns(
        self,
        request: GetTagsForUrnsRequest,
        ctx: RequestContext,
    ) -> GetTagsForUrnsResponse:
        actor_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                ops = TagOperations(session, self.search_indexer)
                content_urns = await ops.filter_viewable_urns(
                    actor_id=actor_id,
                    organization_id=organization_id,
                    content_urns=request.content_urns,
                )
                grouped = await ops.get_for_urns(
                    organization_id=organization_id,
                    content_urns=content_urns,
                )
                all_ids = list({tag.id for tags in grouped.values() for tag in tags})
                counts = await ops._get_usage_counts(organization_id, all_ids)
            entries = [
                UrnTags(
                    content_urn=urn,
                    tags=tags_to_proto_list(tags, counts),
                )
                for urn, tags in grouped.items()
            ]
            return GetTagsForUrnsResponse(entries=entries)
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"get_tags_for_urns failed: {exc}")
            raise _domain_error_to_connect(exc)

    async def list_content_by_tag(
        self,
        request: ListContentByTagRequest,
        ctx: RequestContext,
    ) -> ListContentByTagResponse:
        actor_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        if not request.tag:
            raise ConnectError(Code.INVALID_ARGUMENT, "tag is required")

        criteria_dict: dict = {}
        if request.HasField("criteria"):
            criteria_dict = criteria_from_proto(request.criteria)

        criteria_types = criteria_dict.get("content_types") or []
        merged_content_types = list(request.content_types)
        proto_types_from_criteria: list[int] = []
        for value in criteria_types:
            try:
                ct = ContentType(value)
            except ValueError:
                continue
            proto_types_from_criteria.append(content_type_to_proto(ct))
        merged_content_types.extend(
            t for t in proto_types_from_criteria if t not in merged_content_types
        )

        additional_ids: list[UUID] = []
        for raw in criteria_dict.get("tag_ids") or []:
            try:
                additional_ids.append(UUID(raw))
            except TypeError, ValueError:
                continue
        sources = criteria_dict.get("sources") or None

        try:
            async with open_session() as session:
                ops = TagOperations(session, self.search_indexer)
                assignments, next_token = await ops.list_content(
                    organization_id=organization_id,
                    tag_or_slug=request.tag,
                    content_types=_content_types_from_proto(merged_content_types),
                    additional_tag_ids=additional_ids,
                    sources=sources,
                    page_size=request.page_size or 100,
                    page_token=request.page_token or None,
                    actor_id=actor_id,
                )
            results = [tagged_content_item_to_proto(a) for a in assignments]
            return ListContentByTagResponse(
                results=results,
                next_page_token=next_token or "",
            )
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"list_content_by_tag failed: {exc}")
            raise _domain_error_to_connect(exc)

    async def merge_tags(
        self,
        request: MergeTagsRequest,
        ctx: RequestContext,
    ) -> MergeTagsResponse:
        actor_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        source_id = _parse_uuid(request.source_tag_id, "source_tag_id")
        target_id = _parse_uuid(request.target_tag_id, "target_tag_id")

        try:
            async with open_session() as session:
                ops = TagOperations(session, self.search_indexer)
                target = await ops.merge_tags(
                    actor_id=actor_id,
                    organization_id=organization_id,
                    source_tag_id=source_id,
                    target_tag_id=target_id,
                )
                affected = await ops.list_assigned_urns_for_tag(target.id)
                count = await ops._get_usage_count(organization_id, target.id)

            if affected:
                try:
                    await enqueue_job_reconnecting(
                        REINDEX_TAG_URNS,
                        str(organization_id),
                        affected,
                    )
                except Exception:
                    logger.warning("Failed to enqueue reindex_tag_urns after merge")
            return MergeTagsResponse(tag=tag_to_proto(target, usage_count=count))
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"merge_tags failed: {exc}")
            raise _domain_error_to_connect(exc)
