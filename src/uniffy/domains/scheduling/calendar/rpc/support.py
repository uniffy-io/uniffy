"""Shared calendar RPC parsing and projection helpers."""

from collections.abc import Iterable
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.calendar.template import EventTemplate
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.domains.scheduling.calendar.recurrence import OCCURRENCE_ID_SEPARATOR
from uniffy.domains.tags.reader import TagReader

logger = logger.bind(component="scheduling.calendar.rpc.support")


def parse_uuid(value: str, field: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def parse_event_id(value: str) -> UUID:
    return parse_uuid(value.split(OCCURRENCE_ID_SEPARATOR)[0], "event_id")


def parse_tag_id_list(values: list[str]) -> list[UUID]:
    return [parse_uuid(value, "tag_id") for value in values]


def parse_reminders(values: Iterable[int], *, explicit_empty: bool) -> list[int] | None:
    """``None`` means unspecified: create applies the member's defaults, update
    leaves the rows alone. A proto3 repeated cannot say "none", so the request
    carries that intent as a flag."""
    if explicit_empty:
        return []
    return list(values) or None


async def hydrate_event_tags(
    session: AsyncSession,
    organization_id: UUID,
    event_ids: list[UUID],
) -> dict[str, list]:
    if not event_ids:
        return {}
    urns = [build_content_urn(ContentType.CALENDAR_EVENT, event_id) for event_id in event_ids]
    return await TagReader(session).get_for_urns(
        organization_id=organization_id,
        content_urns=urns,
    )


async def resolve_template_effective_policy(
    session: AsyncSession,
    organization_id: UUID,
    template: EventTemplate,
    checker: PermissionChecker | None = None,
):
    permission_checker = checker or PermissionChecker(session)
    default_mode, default_baseline = await permission_checker.get_org_defaults(
        organization_id,
        ContentType.CALENDAR_EVENT,
    )
    return resolve_effective_policy(
        template.access_mode,
        template.baseline_role,
        default_mode,
        default_baseline,
    )


def map_domain_error(operation: str, exc: Exception) -> ConnectError:
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc) or "Not found")
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc) or "Access denied")
    logger.exception(f"Error in {operation}: {exc}")
    return ConnectError(Code.INTERNAL, "Internal server error")
