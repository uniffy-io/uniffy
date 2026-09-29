"""Resolve saved calendar occurrence references through authorized resource previews."""

from collections.abc import Awaitable, Callable
from dataclasses import replace
from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import AccessMode, ContentType
from uniffy.domains.scheduling.calendar.occurrences import (
    load_occurrence_targets,
    parse_occurrence_reference,
)
from uniffy.domains.search.queries import SearchResult, UrnAvailability

logger = logger.bind(component="search.occurrences")
_PREFIX = "urn:uniffy:content:CALENDAR_EVENT:"


async def resolve_occurrence_references(
    session: AsyncSession,
    organization_id: UUID,
    urns: list[str],
    resolve_resources: Callable[[list[str]], Awaitable[dict[str, SearchResult]]],
) -> dict[str, SearchResult]:
    references = {
        urn: ref
        for urn in urns
        if urn.startswith(_PREFIX)
        and (ref := parse_occurrence_reference(urn.removeprefix(_PREFIX))) is not None
    }
    if not references:
        return await resolve_resources(urns)

    masters = {
        urn: build_content_urn(ContentType.CALENDAR_EVENT, ref.event_id)
        for urn, ref in references.items()
    }
    resources = await resolve_resources(list(dict.fromkeys(masters.get(urn, urn) for urn in urns)))
    resolved = {urn: resources[urn] for urn in urns if urn not in references and urn in resources}
    eligible = []
    for urn, ref in references.items():
        master = resources.get(masters[urn])
        if master is None:
            resolved[urn] = _empty_result(urn, organization_id, UrnAvailability.UNAVAILABLE)
        elif master.availability != UrnAvailability.AVAILABLE:
            resolved[urn] = replace(master, urn=urn, can_request_access=False)
        else:
            eligible.append(ref)

    if not eligible:
        return resolved

    try:
        targets = await load_occurrence_targets(session, organization_id, eligible)
        override_urns = list(
            dict.fromkeys(
                build_content_urn(ContentType.CALENDAR_EVENT, target.event_id)
                for ref, target in targets.items()
                if target is not None and target.event_id != ref.event_id
            )
        )
        overrides = await resolve_resources(override_urns) if override_urns else {}
        for urn, ref in references.items():
            if urn in resolved:
                continue
            if ref not in targets:
                resolved[urn] = _empty_result(urn, organization_id, UrnAvailability.UNAVAILABLE)
                continue
            target = targets.get(ref)
            if target is None:
                resolved[urn] = _empty_result(urn, organization_id, UrnAvailability.DELETED)
            elif target.event_id != ref.event_id:
                override_urn = build_content_urn(ContentType.CALENDAR_EVENT, target.event_id)
                override = overrides.get(override_urn)
                resolved[urn] = (
                    replace(override, urn=urn, can_request_access=False)
                    if override is not None
                    else _empty_result(urn, organization_id, UrnAvailability.UNAVAILABLE)
                )
            else:
                resolved[urn] = replace(
                    resources[masters[urn]],
                    urn=urn,
                    url_path=f"/calendar?event={ref.id}",
                    event_start_time=target.start_time.isoformat() if target.start_time else None,
                    event_end_time=target.end_time.isoformat() if target.end_time else None,
                )
    except Exception:
        logger.opt(exception=True).warning("Calendar occurrence lookup failed")
        for urn in references:
            if urn not in resolved:
                resolved[urn] = _empty_result(urn, organization_id, UrnAvailability.UNAVAILABLE)
    return resolved


def _empty_result(urn: str, organization_id: UUID, availability: UrnAvailability) -> SearchResult:
    return SearchResult(
        urn=urn,
        organization_id=organization_id,
        title="",
        description=None,
        entity_type=ContentType.CALENDAR_EVENT.value.lower(),
        url_path="",
        access_mode=AccessMode.OWNER_ONLY.value,
        baseline_role=None,
        owner_id=organization_id,
        tags=None,
        metadata=None,
        updated_at=None,
        rank_score=0.0,
        search_score=None,
        availability=availability,
    )
