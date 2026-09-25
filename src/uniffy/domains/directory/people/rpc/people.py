from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.common.v1 import common_pb as common
from uniffy_proto.people.v1 import people_pb as pb

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters.proto import timestamp_to_datetime
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.domains.directory.people.access import ViewerRelation, relation_for
from uniffy.domains.directory.people.cache import cached_org_chart
from uniffy.domains.directory.people.chart import build_org_chart_payload
from uniffy.domains.directory.people.converters import chart_payload_to_proto, profile_to_proto
from uniffy.domains.directory.people.operations import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    PeopleOperations,
)
from uniffy.domains.directory.people.policy import load_profile_policy
from uniffy.domains.directory.people.reader import PeopleReader, load_person_payload
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="directory.people.rpc.people")

_ADMIN_ROLES = (OrganizationRole.OWNER, OrganizationRole.ADMIN)

_MY_PROFILE_SCALARS = (
    "work_phone",
    "mobile_phone",
    "timezone",
    "bio",
    "birthday",
)
_ADMIN_PROFILE_SCALARS = (
    "job_title",
    "department",
    "office_location",
    "work_phone",
    "mobile_phone",
)


def _is_admin(membership: OrganizationMember) -> bool:
    return membership.role in _ADMIN_ROLES


def _profile_changes(
    request,
    scalar_fields: tuple[str, ...],
    *,
    with_links: bool,
    with_start_date: bool,
) -> dict:
    changes: dict = {}
    for name in scalar_fields:
        if request.has_field(name):
            value = getattr(request, name)
            changes[name] = value if value else None
    if with_start_date and request.has_field("start_date"):
        changes["start_date"] = timestamp_to_datetime(request.start_date).date()
    if with_links and request.has_field("links"):
        changes["links"] = [{"label": link.label, "url": link.url} for link in request.links.links]
    return changes


class PeopleHandlers:
    async def list_people(
        self,
        request: pb.ListPeopleRequest,
        ctx: RequestContext,
    ) -> pb.ListPeopleResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                include_inactive = (
                    request.include_inactive if request.has_field("include_inactive") else False
                )

                page = 1
                page_size = DEFAULT_PAGE_SIZE
                if request.has_field("pagination"):
                    page = max(1, request.pagination.page or 1)
                    page_size = min(
                        max(1, request.pagination.page_size or DEFAULT_PAGE_SIZE),
                        MAX_PAGE_SIZE,
                    )

                page_result = await PeopleReader(session).list_people(
                    actor_user_id=user_id,
                    organization_id=org_id,
                    page=page,
                    page_size=page_size,
                    search=request.search if request.has_field("search") else None,
                    department=request.department if request.has_field("department") else None,
                    team_id=UUID(request.team_id) if request.has_field("team_id") else None,
                    include_inactive=include_inactive,
                )
                people = [
                    profile_to_proto(
                        payload,
                        relation=relation_for(
                            user_id,
                            UUID(payload["user_id"]),
                            is_admin=page_result.is_admin,
                        ),
                    )
                    for payload in page_result.people
                ]

            return pb.ListPeopleResponse(
                people=people,
                pagination=common.PaginationResponse(
                    page=page,
                    page_size=page_size,
                    total_count=page_result.total,
                    total_pages=(page_result.total + page_size - 1) // page_size,
                ),
            )
        except ConnectError:
            raise
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except (ValidationError, ValueError) as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            logger.exception(f"Error listing people: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_person(
        self,
        request: pb.GetPersonRequest,
        ctx: RequestContext,
    ) -> pb.GetPersonResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

        try:
            target_id = UUID(request.user_id)
            async with open_session() as session:
                payload, is_admin = await PeopleReader(session).get_person(
                    actor_user_id=user_id,
                    organization_id=org_id,
                    target_user_id=target_id,
                )

            return pb.GetPersonResponse(
                person=profile_to_proto(
                    payload,
                    relation=relation_for(user_id, target_id, is_admin=is_admin),
                )
            )
        except ConnectError:
            raise
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except (ValidationError, ValueError) as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            logger.exception(f"Error fetching person: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_my_profile(
        self,
        request: pb.UpdateMyProfileRequest,
        ctx: RequestContext,
    ) -> pb.UpdateMyProfileResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

        try:
            changes = _profile_changes(
                request,
                _MY_PROFILE_SCALARS,
                with_links=True,
                with_start_date=False,
            )
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(user_id, org_id)
                ops = PeopleOperations(session, self.search_indexer)
                await ops.update_my_profile(org_id, user_id, changes)
                payload = await load_person_payload(session, org_id, user_id)
            return pb.UpdateMyProfileResponse(
                person=profile_to_proto(payload, relation=ViewerRelation.SELF)
            )
        except ConnectError:
            raise
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except (ValidationError, ValueError) as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            logger.exception(f"Error updating own profile: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_person_profile(
        self,
        request: pb.UpdatePersonProfileRequest,
        ctx: RequestContext,
    ) -> pb.UpdatePersonProfileResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

        try:
            target_id = UUID(request.user_id)
            changes = _profile_changes(
                request,
                _ADMIN_PROFILE_SCALARS,
                with_links=False,
                with_start_date=True,
            )
            async with open_session() as session:
                membership = await OrganizationOperations(session).require_org_member(
                    user_id,
                    org_id,
                )
                ops = PeopleOperations(session, self.search_indexer)
                await ops.update_person_profile(org_id, user_id, target_id, changes)
                payload = await load_person_payload(session, org_id, target_id)
            return pb.UpdatePersonProfileResponse(
                person=profile_to_proto(
                    payload,
                    relation=relation_for(user_id, target_id, is_admin=_is_admin(membership)),
                )
            )
        except ConnectError:
            raise
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except (ValidationError, ValueError) as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            logger.exception(f"Error updating person profile: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def set_manager(
        self,
        request: pb.SetManagerRequest,
        ctx: RequestContext,
    ) -> pb.SetManagerResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

        try:
            target_id = UUID(request.user_id)
            manager_id = (
                UUID(request.manager_user_id) if request.has_field("manager_user_id") else None
            )
            async with open_session() as session:
                membership = await OrganizationOperations(session).require_org_member(
                    user_id,
                    org_id,
                )
                ops = PeopleOperations(session, self.search_indexer)
                await ops.set_manager(org_id, user_id, target_id, manager_id)
                payload = await load_person_payload(session, org_id, target_id)
            return pb.SetManagerResponse(
                person=profile_to_proto(
                    payload,
                    relation=relation_for(user_id, target_id, is_admin=_is_admin(membership)),
                )
            )
        except ConnectError:
            raise
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except (ValidationError, ValueError) as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            logger.exception(f"Error setting manager: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_org_chart(
        self,
        request: pb.GetOrgChartRequest,
        ctx: RequestContext,
    ) -> pb.GetOrgChartResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(user_id, org_id)
                policy = await load_profile_policy(session, org_id)
                if not policy.org_chart_enabled:
                    return pb.GetOrgChartResponse(enabled=False)

                payload = await cached_org_chart(
                    org_id,
                    lambda: build_org_chart_payload(session, org_id),
                )
            return chart_payload_to_proto(payload, enabled=True)
        except ConnectError:
            raise
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except Exception as exc:
            logger.exception(f"Error building org chart: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
