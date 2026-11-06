from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.people.v1 import people_pb as pb

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.errors import PermissionDeniedError, RateLimitExceededError
from uniffy.core.rate_limit import check_rate_limit
from uniffy.domains.directory.collaborators.reader import (
    DEFAULT_LIMIT,
    MAX_EXCLUDED,
    CollaboratorReader,
)
from uniffy.domains.directory.collaborators.signals import CollaboratorSignal, stage_interactions
from uniffy.domains.directory.people.converters import collaborator_to_proto
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="directory.people.rpc.collaborators")

MAX_PICKS = 20
_PICKS_PER_MINUTE = 30


def _parse_ids(values: list[str], cap: int) -> frozenset[UUID]:
    ids: set[UUID] = set()
    for value in values[:cap]:
        try:
            ids.add(UUID(value))
        except ValueError:
            continue
    return frozenset(ids)


class CollaboratorHandlers:
    async def list_collaborators(
        self,
        request: pb.ListCollaboratorsRequest,
        ctx: RequestContext,
    ) -> pb.ListCollaboratorsResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(user_id, org_id)
                rows = await CollaboratorReader(session).list(
                    org_id,
                    user_id,
                    query=request.query if request.has_field("query") else "",
                    limit=request.limit if request.limit > 0 else DEFAULT_LIMIT,
                    exclude_user_ids=_parse_ids(list(request.exclude_user_ids), MAX_EXCLUDED),
                )
            return pb.ListCollaboratorsResponse(
                collaborators=[collaborator_to_proto(row) for row in rows]
            )
        except ConnectError:
            raise
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except Exception as exc:
            logger.exception(f"Error listing collaborators: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def record_people_picks(
        self,
        request: pb.RecordPeoplePicksRequest,
        ctx: RequestContext,
    ) -> pb.RecordPeoplePicksResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)
        peer_ids = _parse_ids(list(request.user_ids), MAX_PICKS) - {user_id}

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(user_id, org_id)
                if not peer_ids:
                    return pb.RecordPeoplePicksResponse()
                try:
                    await check_rate_limit(
                        key=f"rl:people_picks:{org_id}:{user_id}",
                        limit=_PICKS_PER_MINUTE,
                        window_seconds=60,
                        resource="people picks",
                    )
                except RateLimitExceededError:
                    # Picks only tune suggestions; dropping a burst is harmless.
                    return pb.RecordPeoplePicksResponse()
                await stage_interactions(
                    session,
                    org_id,
                    [(user_id, peer_id, CollaboratorSignal.PICK) for peer_id in peer_ids],
                )
                await session.commit()
            return pb.RecordPeoplePicksResponse()
        except ConnectError:
            raise
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except Exception as exc:
            logger.exception(f"Error recording people picks: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
