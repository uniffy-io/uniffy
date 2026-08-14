"""People service RPC handlers."""

import json
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.common.v1 import common_pb2 as common
from uniffy_proto.people.v1 import people_pb2 as pb

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.converters.proto import timestamp_to_datetime
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.people.identity import IdentitySource, IdentitySourceKind
from uniffy.core.valkey.queue import get_queue
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context, resolve_organization_id
from uniffy.domains.org_settings.operations import OrgSettingsOperations
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.people import teams as team_ops
from uniffy.domains.people.access import ViewerRelation, relation_for
from uniffy.domains.people.cache import (
    cached_org_chart,
)
from uniffy.domains.people.chart import build_org_chart_payload
from uniffy.domains.people.converters import (
    SOURCE_KIND_FROM_PROTO,
    chart_payload_to_proto,
    identity_source_to_proto,
    policy_to_proto,
    profile_to_proto,
    team_node_to_proto,
)
from uniffy.domains.people.directory.registry import (
    IDENTITY_SECRET_NAMESPACE,
    capabilities_for,
    has_provider,
    parse_source_config,
)
from uniffy.domains.people.operations import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    PeopleOperations,
)
from uniffy.domains.people.policy import (
    ResolvedProfilePolicy,
    load_profile_policy,
    save_profile_policy,
)
from uniffy.domains.people.reader import PeopleReader, load_person_payload

logger = logger.bind(component="people.handlers")

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
    """Present field = set it; empty string clears; absent = unchanged."""
    changes: dict = {}
    for name in scalar_fields:
        if request.HasField(name):
            value = getattr(request, name)
            changes[name] = value if value else None
    if with_start_date and request.HasField("start_date"):
        changes["start_date"] = timestamp_to_datetime(request.start_date).date()
    if with_links and request.HasField("links"):
        changes["links"] = [
            {"label": link.label, "url": link.url} for link in request.links.links
        ]
    return changes


def _parse_config_json(raw: str) -> dict:
    if not raw or not raw.strip():
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValidationError("config_json", "must be valid JSON") from e
    if not isinstance(value, dict):
        raise ValidationError("config_json", "must be a JSON object")
    return value


def _require_source_name(raw: str) -> str:
    name = raw.strip()
    if not name:
        raise ValidationError("name", "must not be empty")
    if len(name) > 255:
        raise ValidationError("name", "must be at most 255 chars")
    return name


async def _load_source(session: AsyncSession, org_id: UUID, source_id: str) -> IdentitySource:
    source = (
        await session.execute(
            select(IdentitySource).where(
                IdentitySource.id == UUID(source_id),
                IdentitySource.organization_id == org_id,
            )
        )
    ).scalar_one_or_none()
    if source is None:
        raise NotFoundError("IdentitySource", source_id)
    return source


async def _require_single_active_source(
    session: AsyncSession, org_id: UUID, exclude_id: UUID | None = None
) -> None:
    """At most one ACTIVE non-LOCAL source per org: `managed_fields` has no
    per-field source attribution, so two syncing sources would silently
    last-write-win over each other."""
    query = select(IdentitySource.id).where(
        IdentitySource.organization_id == org_id,
        IdentitySource.is_active.is_(True),
        IdentitySource.kind != IdentitySourceKind.LOCAL,
    )
    if exclude_id is not None:
        query = query.where(IdentitySource.id != exclude_id)
    existing = (await session.execute(query.limit(1))).scalar_one_or_none()
    if existing is not None:
        raise ValidationError(
            "is_active", "another sync source is already active; deactivate it first"
        )


class PeopleHandlers:
    """Handlers for PeopleService RPC methods."""

    async def list_people(
        self,
        request: pb.ListPeopleRequest,
        ctx: RequestContext,
    ) -> pb.ListPeopleResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            async with open_session() as session:
                include_inactive = (
                    request.include_inactive if request.HasField("include_inactive") else False
                )

                page = 1
                page_size = DEFAULT_PAGE_SIZE
                if request.HasField("pagination"):
                    page = max(1, request.pagination.page or 1)
                    page_size = min(
                        max(1, request.pagination.page_size or DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE
                    )

                page_result = await PeopleReader(session).list_people(
                    actor_user_id=user_id,
                    organization_id=org_id,
                    page=page,
                    page_size=page_size,
                    search=request.search if request.HasField("search") else None,
                    department=request.department if request.HasField("department") else None,
                    team_id=UUID(request.team_id) if request.HasField("team_id") else None,
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
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except (ValidationError, ValueError) as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Error listing people: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_person(
        self,
        request: pb.GetPersonRequest,
        ctx: RequestContext,
    ) -> pb.GetPersonResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            target_id = UUID(request.user_id)
            async with open_session() as session:
                # Deliberately not gated on directory_enabled - mention hover
                # cards and user chips must keep working when it is off.
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
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except (ValidationError, ValueError) as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Error fetching person: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_my_profile(
        self,
        request: pb.UpdateMyProfileRequest,
        ctx: RequestContext,
    ) -> pb.UpdateMyProfileResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            changes = _profile_changes(
                request, _MY_PROFILE_SCALARS, with_links=True, with_start_date=False
            )
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(user_id, org_id)
                ops = PeopleOperations(session)
                await ops.update_my_profile(org_id, user_id, changes)
                payload = await load_person_payload(session, org_id, user_id)
            return pb.UpdateMyProfileResponse(
                person=profile_to_proto(payload, relation=ViewerRelation.SELF)
            )
        except ConnectError:
            raise
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except (ValidationError, ValueError) as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Error updating own profile: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_person_profile(
        self,
        request: pb.UpdatePersonProfileRequest,
        ctx: RequestContext,
    ) -> pb.UpdatePersonProfileResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            target_id = UUID(request.user_id)
            changes = _profile_changes(
                request, _ADMIN_PROFILE_SCALARS, with_links=False, with_start_date=True
            )
            async with open_session() as session:
                membership = await OrganizationOperations(session).require_org_member(
                    user_id, org_id
                )
                ops = PeopleOperations(session)
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
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except (ValidationError, ValueError) as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Error updating person profile: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def set_manager(
        self,
        request: pb.SetManagerRequest,
        ctx: RequestContext,
    ) -> pb.SetManagerResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            target_id = UUID(request.user_id)
            manager_id = (
                UUID(request.manager_user_id) if request.HasField("manager_user_id") else None
            )
            async with open_session() as session:
                membership = await OrganizationOperations(session).require_org_member(
                    user_id, org_id
                )
                ops = PeopleOperations(session)
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
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except (ValidationError, ValueError) as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Error setting manager: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_org_chart(
        self,
        request: pb.GetOrgChartRequest,
        ctx: RequestContext,
    ) -> pb.GetOrgChartResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(user_id, org_id)
                policy = await load_profile_policy(session, org_id)
                if not policy.org_chart_enabled:
                    # enabled=false lets the client tell "disabled" from
                    # "no managers set yet".
                    return pb.GetOrgChartResponse(enabled=False)

                payload = await cached_org_chart(
                    org_id, lambda: build_org_chart_payload(session, org_id)
                )
            return chart_payload_to_proto(payload, enabled=True)
        except ConnectError:
            raise
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.exception(f"Error building org chart: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_teams(
        self,
        request: pb.ListTeamsRequest,
        ctx: RequestContext,
    ) -> pb.ListTeamsResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(user_id, org_id)
                nodes = await team_ops.list_team_nodes(session, org_id)
            return pb.ListTeamsResponse(teams=[team_node_to_proto(node) for node in nodes])
        except ConnectError:
            raise
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.exception(f"Error listing teams: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_team(
        self,
        request: pb.GetTeamRequest,
        ctx: RequestContext,
    ) -> pb.GetTeamResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            group_id = UUID(request.group_id)
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(user_id, org_id)
                node, member_ids = await team_ops.get_team(session, org_id, group_id)
            return pb.GetTeamResponse(team=team_node_to_proto(node), member_user_ids=member_ids)
        except ConnectError:
            raise
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except (ValidationError, ValueError) as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Error fetching team: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_team(
        self,
        request: pb.UpdateTeamRequest,
        ctx: RequestContext,
    ) -> pb.UpdateTeamResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            group_id = UUID(request.group_id)
            if request.clear_lead:
                lead: UUID | None | object = None
            elif request.HasField("lead_user_id"):
                lead = UUID(request.lead_user_id)
            else:
                lead = team_ops.UNSET
            if request.clear_parent:
                parent: UUID | None | object = None
            elif request.HasField("parent_group_id"):
                parent = UUID(request.parent_group_id)
            else:
                parent = team_ops.UNSET

            async with open_session() as session:
                await OrganizationOperations(session).require_org_admin(user_id, org_id)
                node = await team_ops.update_team(
                    session,
                    org_id,
                    user_id,
                    group_id,
                    lead_user_id=lead,
                    parent_group_id=parent,
                )
            return pb.UpdateTeamResponse(team=team_node_to_proto(node))
        except ConnectError:
            raise
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except (ValidationError, ValueError) as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Error updating team: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_profile_policy(
        self,
        request: pb.GetProfilePolicyRequest,
        ctx: RequestContext,
    ) -> pb.GetProfilePolicyResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            async with open_session() as session:
                # Member-open so the client can hide disabled surfaces.
                await OrganizationOperations(session).require_org_member(user_id, org_id)
                policy = await load_profile_policy(session, org_id)
            return pb.GetProfilePolicyResponse(policy=policy_to_proto(policy))
        except ConnectError:
            raise
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.exception(f"Error fetching profile policy: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_profile_policy(
        self,
        request: pb.UpdateProfilePolicyRequest,
        ctx: RequestContext,
    ) -> pb.UpdateProfilePolicyResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_admin(user_id, org_id)

                policy = ResolvedProfilePolicy(
                    organization_id=org_id,
                    directory_enabled=request.policy.directory_enabled,
                    org_chart_enabled=request.policy.org_chart_enabled,
                )
                await save_profile_policy(session, policy=policy, updated_by_user_id=user_id)
                await session.commit()
            return pb.UpdateProfilePolicyResponse(policy=policy_to_proto(policy))
        except ConnectError:
            raise
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except (ValidationError, ValueError) as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Error updating profile policy: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_identity_sources(
        self,
        request: pb.ListIdentitySourcesRequest,
        ctx: RequestContext,
    ) -> pb.ListIdentitySourcesResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_admin(user_id, org_id)
                sources = (
                    (
                        await session.execute(
                            select(IdentitySource)
                            .where(IdentitySource.organization_id == org_id)
                            .order_by(IdentitySource.created_at)
                        )
                    )
                    .scalars()
                    .all()
                )
            return pb.ListIdentitySourcesResponse(
                sources=[identity_source_to_proto(source) for source in sources]
            )
        except ConnectError:
            raise
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.exception(f"Error listing identity sources: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def create_identity_source(
        self,
        request: pb.CreateIdentitySourceRequest,
        ctx: RequestContext,
    ) -> pb.CreateIdentitySourceResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            kind = SOURCE_KIND_FROM_PROTO.get(request.kind)
            if kind is None:
                raise ValidationError("kind", "kind is required")
            if kind is IdentitySourceKind.LOCAL:
                raise ValidationError("kind", "the LOCAL source is built in")
            name = _require_source_name(request.name)
            config = _parse_config_json(request.config_json)
            parse_source_config(kind, config)

            async with open_session() as session:
                await OrganizationOperations(session).require_org_admin(user_id, org_id)
                await _require_single_active_source(session, org_id)

                source = IdentitySource(
                    organization_id=org_id, kind=kind, name=name, config=config
                )
                session.add(source)
                await session.flush()

                if request.HasField("secret") and request.secret:
                    await OrgSettingsOperations(session).set(
                        organization_id=org_id,
                        namespace=IDENTITY_SECRET_NAMESPACE,
                        key=str(source.id),
                        value=request.secret,
                        is_secret=True,
                        updated_by_user_id=user_id,
                    )

                await write_audit_event(
                    session,
                    organization_id=org_id,
                    actor_user_id=user_id,
                    action=Action.IDENTITY_SOURCE_CREATED,
                    resource_type="IDENTITY_SOURCE",
                    resource_id=source.id,
                    details={"kind": kind.value, "name": name},
                )
                await session.commit()
                await session.refresh(source)
                message = identity_source_to_proto(source)
            return pb.CreateIdentitySourceResponse(source=message)
        except ConnectError:
            raise
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except (ValidationError, ValueError) as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Error creating identity source: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_identity_source(
        self,
        request: pb.UpdateIdentitySourceRequest,
        ctx: RequestContext,
    ) -> pb.UpdateIdentitySourceResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_admin(user_id, org_id)
                source = await _load_source(session, org_id, request.source_id)

                changed: list[str] = []
                if request.HasField("name"):
                    source.name = _require_source_name(request.name)
                    changed.append("name")
                if request.HasField("config_json"):
                    config = _parse_config_json(request.config_json)
                    parse_source_config(source.kind, config)
                    source.config = config
                    changed.append("config")
                if request.HasField("is_active"):
                    if source.kind is IdentitySourceKind.LOCAL and not request.is_active:
                        raise ValidationError(
                            "is_active", "the LOCAL source cannot be deactivated"
                        )
                    if request.is_active and source.kind is not IdentitySourceKind.LOCAL:
                        await _require_single_active_source(
                            session, org_id, exclude_id=source.id
                        )
                    source.is_active = request.is_active
                    changed.append("is_active")
                if request.HasField("secret") and request.secret:
                    await OrgSettingsOperations(session).set(
                        organization_id=org_id,
                        namespace=IDENTITY_SECRET_NAMESPACE,
                        key=str(source.id),
                        value=request.secret,
                        is_secret=True,
                        updated_by_user_id=user_id,
                    )
                    changed.append("secret")

                if changed:
                    await write_audit_event(
                        session,
                        organization_id=org_id,
                        actor_user_id=user_id,
                        action=Action.IDENTITY_SOURCE_UPDATED,
                        resource_type="IDENTITY_SOURCE",
                        resource_id=source.id,
                        details={"changed_keys": changed},
                    )
                    await session.commit()
                    await session.refresh(source)
                message = identity_source_to_proto(source)
            return pb.UpdateIdentitySourceResponse(source=message)
        except ConnectError:
            raise
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except (ValidationError, ValueError) as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Error updating identity source: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_identity_source(
        self,
        request: pb.DeleteIdentitySourceRequest,
        ctx: RequestContext,
    ) -> pb.DeleteIdentitySourceResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_admin(user_id, org_id)
                source = await _load_source(session, org_id, request.source_id)
                if source.kind is IdentitySourceKind.LOCAL:
                    raise ValidationError("source", "the LOCAL source cannot be deleted")

                # The encrypted secret goes with the source; links CASCADE at the DB.
                await OrgSettingsOperations(session).delete_key(
                    organization_id=org_id,
                    namespace=IDENTITY_SECRET_NAMESPACE,
                    key=str(source.id),
                )
                await write_audit_event(
                    session,
                    organization_id=org_id,
                    actor_user_id=user_id,
                    action=Action.IDENTITY_SOURCE_DELETED,
                    resource_type="IDENTITY_SOURCE",
                    resource_id=source.id,
                    details={"kind": source.kind.value, "name": source.name},
                )
                await session.delete(source)
                await session.commit()
            return pb.DeleteIdentitySourceResponse()
        except ConnectError:
            raise
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except (ValidationError, ValueError) as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Error deleting identity source: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def trigger_directory_sync(
        self,
        request: pb.TriggerDirectorySyncRequest,
        ctx: RequestContext,
    ) -> pb.TriggerDirectorySyncResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_admin(user_id, org_id)
                source = await _load_source(session, org_id, request.source_id)
                if not source.is_active:
                    raise ValidationError("source", "source is inactive")
                if not capabilities_for(source.kind).supports_pull_users:
                    raise ValidationError(
                        "kind", "this source kind cannot be enumerated - nothing to pull"
                    )
                if not has_provider(source.kind):
                    raise ValidationError(
                        "kind", "no connector for this source kind is available yet"
                    )
                source_id = source.id

            # Enqueue and return; a sync never runs on the request thread.
            queue = get_queue("egress")
            await queue.enqueue_job("sync_identity_source", str(source_id))
            return pb.TriggerDirectorySyncResponse(enqueued=True)
        except ConnectError:
            raise
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except (ValidationError, ValueError) as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Error triggering directory sync: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
