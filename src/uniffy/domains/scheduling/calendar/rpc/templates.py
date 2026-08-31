"""Calendar event-template RPC handlers."""

import contextlib
from uuid import UUID

from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.cal.v1.calendar_pb2 import (
    CreateEventTemplateRequest,
    CreateEventTemplateResponse,
    DeleteEventTemplateRequest,
    DeleteEventTemplateResponse,
    GetEventTemplateRequest,
    GetEventTemplateResponse,
    ListEventTemplatesRequest,
    ListEventTemplatesResponse,
    UpdateEventTemplateRequest,
    UpdateEventTemplateResponse,
)

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.types import ContentType
from uniffy.domains.scheduling.calendar.converters import template_to_proto
from uniffy.domains.scheduling.calendar.rpc.support import (
    map_domain_error,
    parse_uuid,
    resolve_template_effective_policy,
)
from uniffy.domains.scheduling.calendar.templates.operations import EventTemplateOperations
from uniffy.infrastructure.database import open_session


class TemplateHandlers:
    async def create_event_template(
        self,
        request: CreateEventTemplateRequest,
        ctx: RequestContext,
    ) -> CreateEventTemplateResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        access_mode = access_mode_from_proto(request.access_mode) if request.access_mode else None
        baseline_role = (
            content_role_from_proto(request.baseline_role) if request.baseline_role else None
        )

        category_id = None
        if request.category_id:
            with contextlib.suppress(ValueError):
                category_id = UUID(request.category_id)

        try:
            async with open_session() as session:
                template = await EventTemplateOperations(session).create(
                    user_id=user_id,
                    organization_id=organization_id,
                    title=request.title,
                    description=request.description,
                    duration_minutes=request.duration_minutes,
                    location=request.location,
                    meeting_url=request.meeting_url if request.meeting_url else None,
                    category_id=category_id,
                    tags=list(request.tags),
                    access_mode=access_mode,
                    baseline_role=baseline_role,
                )
                effective_mode, effective_baseline = await resolve_template_effective_policy(
                    session, organization_id, template
                )
                return CreateEventTemplateResponse(
                    template=template_to_proto(
                        template,
                        effective_access_mode=effective_mode,
                        effective_baseline_role=effective_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_event_template", exc) from exc

    async def get_event_template(
        self,
        request: GetEventTemplateRequest,
        ctx: RequestContext,
    ) -> GetEventTemplateResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        template_id = parse_uuid(request.template_id, "template_id")

        try:
            async with open_session() as session:
                template = await EventTemplateOperations(session).get_by_id(
                    template_id, organization_id, user_id
                )
                effective_mode, effective_baseline = await resolve_template_effective_policy(
                    session, organization_id, template
                )
                return GetEventTemplateResponse(
                    template=template_to_proto(
                        template,
                        effective_access_mode=effective_mode,
                        effective_baseline_role=effective_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_event_template", exc) from exc

    async def update_event_template(
        self,
        request: UpdateEventTemplateRequest,
        ctx: RequestContext,
    ) -> UpdateEventTemplateResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        template_id = parse_uuid(request.template_id, "template_id")

        update_data: dict = {}
        for field in ("title", "description", "duration_minutes", "location", "meeting_url"):
            if request.HasField(field):
                update_data[field] = getattr(request, field)
        if request.HasField("category_id"):
            try:
                update_data["category_id"] = UUID(request.category_id)
            except ValueError:
                update_data["category_id"] = None
        if request.tags:
            update_data["tags"] = list(request.tags)

        try:
            async with open_session() as session:
                template = await EventTemplateOperations(session).update(
                    template_id=template_id,
                    organization_id=organization_id,
                    user_id=user_id,
                    **update_data,
                )
                effective_mode, effective_baseline = await resolve_template_effective_policy(
                    session, organization_id, template
                )
                return UpdateEventTemplateResponse(
                    template=template_to_proto(
                        template,
                        effective_access_mode=effective_mode,
                        effective_baseline_role=effective_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_event_template", exc) from exc

    async def delete_event_template(
        self,
        request: DeleteEventTemplateRequest,
        ctx: RequestContext,
    ) -> DeleteEventTemplateResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        template_id = parse_uuid(request.template_id, "template_id")

        try:
            async with open_session() as session:
                await EventTemplateOperations(session).delete(template_id, organization_id, user_id)
                return DeleteEventTemplateResponse(success=True, message="Template deleted")
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_event_template", exc) from exc

    async def list_event_templates(
        self,
        request: ListEventTemplatesRequest,
        ctx: RequestContext,
    ) -> ListEventTemplatesResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                templates = await EventTemplateOperations(session).list(organization_id, user_id)
                checker = PermissionChecker(session)
                default_mode, default_baseline = await checker.get_org_defaults(
                    organization_id,
                    ContentType.CALENDAR_EVENT,
                )
                proto_templates = []
                for template in templates:
                    effective_mode, effective_baseline = resolve_effective_policy(
                        template.access_mode,
                        template.baseline_role,
                        default_mode,
                        default_baseline,
                    )
                    proto_templates.append(
                        template_to_proto(
                            template,
                            effective_access_mode=effective_mode,
                            effective_baseline_role=effective_baseline,
                        )
                    )
                return ListEventTemplatesResponse(templates=proto_templates)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_event_templates", exc) from exc
