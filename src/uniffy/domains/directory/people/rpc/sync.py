from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.people.v1 import people_pb as pb

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.config.settings.organization import OrgSettingsOperations
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.jobs import enqueue_job
from uniffy.core.json_codec import JSONDecodeError, loads
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.people.identity import IdentitySource, IdentitySourceKind
from uniffy.domains.directory.people.converters import (
    SOURCE_KIND_FROM_PROTO,
    identity_source_to_proto,
)
from uniffy.domains.directory.sync.jobs.contracts import SYNC_IDENTITY_SOURCE
from uniffy.domains.directory.sync.registry import (
    IDENTITY_SECRET_NAMESPACE,
    capabilities_for,
    has_provider,
    parse_source_config,
)
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="directory.people.rpc.sync")


def _parse_config_json(raw: str) -> dict:
    if not raw or not raw.strip():
        return {}
    try:
        value = loads(raw)
    except JSONDecodeError as exc:
        raise ValidationError("config_json", "must be valid JSON") from exc
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


async def _load_source(
    session: AsyncSession,
    org_id: UUID,
    source_id: str,
) -> IdentitySource:
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
    session: AsyncSession,
    org_id: UUID,
    exclude_id: UUID | None = None,
) -> None:
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
            "is_active",
            "another sync source is already active; deactivate it first",
        )


class IdentitySourceHandlers:
    async def list_identity_sources(
        self,
        request: pb.ListIdentitySourcesRequest,
        ctx: RequestContext,
    ) -> pb.ListIdentitySourcesResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

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
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except Exception as exc:
            logger.exception(f"Error listing identity sources: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def create_identity_source(
        self,
        request: pb.CreateIdentitySourceRequest,
        ctx: RequestContext,
    ) -> pb.CreateIdentitySourceResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

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

                source = IdentitySource(organization_id=org_id, kind=kind, name=name, config=config)
                session.add(source)
                await session.flush()

                if request.has_field("secret") and request.secret:
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
                    resource_type=AuditResourceType.IDENTITY_SOURCE,
                    resource_id=source.id,
                    details={"kind": kind.value, "name": name},
                )
                await session.commit()
                await session.refresh(source)
                message = identity_source_to_proto(source)
            return pb.CreateIdentitySourceResponse(source=message)
        except ConnectError:
            raise
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except (ValidationError, ValueError) as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            logger.exception(f"Error creating identity source: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_identity_source(
        self,
        request: pb.UpdateIdentitySourceRequest,
        ctx: RequestContext,
    ) -> pb.UpdateIdentitySourceResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_admin(user_id, org_id)
                source = await _load_source(session, org_id, request.source_id)

                changed: list[str] = []
                if request.has_field("name"):
                    source.name = _require_source_name(request.name)
                    changed.append("name")
                if request.has_field("config_json"):
                    config = _parse_config_json(request.config_json)
                    parse_source_config(source.kind, config)
                    source.config = config
                    changed.append("config")
                if request.has_field("is_active"):
                    if source.kind is IdentitySourceKind.LOCAL and not request.is_active:
                        raise ValidationError("is_active", "the LOCAL source cannot be deactivated")
                    if request.is_active and source.kind is not IdentitySourceKind.LOCAL:
                        await _require_single_active_source(session, org_id, exclude_id=source.id)
                    source.is_active = request.is_active
                    changed.append("is_active")
                if request.has_field("secret") and request.secret:
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
                        resource_type=AuditResourceType.IDENTITY_SOURCE,
                        resource_id=source.id,
                        details={"changed_keys": changed},
                    )
                    await session.commit()
                    await session.refresh(source)
                message = identity_source_to_proto(source)
            return pb.UpdateIdentitySourceResponse(source=message)
        except ConnectError:
            raise
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except (ValidationError, ValueError) as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            logger.exception(f"Error updating identity source: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_identity_source(
        self,
        request: pb.DeleteIdentitySourceRequest,
        ctx: RequestContext,
    ) -> pb.DeleteIdentitySourceResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_admin(user_id, org_id)
                source = await _load_source(session, org_id, request.source_id)
                if source.kind is IdentitySourceKind.LOCAL:
                    raise ValidationError("source", "the LOCAL source cannot be deleted")

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
                    resource_type=AuditResourceType.IDENTITY_SOURCE,
                    resource_id=source.id,
                    details={"kind": source.kind.value, "name": source.name},
                )
                await session.delete(source)
                await session.commit()
            return pb.DeleteIdentitySourceResponse()
        except ConnectError:
            raise
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except (ValidationError, ValueError) as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            logger.exception(f"Error deleting identity source: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def trigger_directory_sync(
        self,
        request: pb.TriggerDirectorySyncRequest,
        ctx: RequestContext,
    ) -> pb.TriggerDirectorySyncResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_admin(user_id, org_id)
                source = await _load_source(session, org_id, request.source_id)
                if not source.is_active:
                    raise ValidationError("source", "source is inactive")
                if not capabilities_for(source.kind).supports_pull_users:
                    raise ValidationError(
                        "kind",
                        "this source kind cannot be enumerated - nothing to pull",
                    )
                if not has_provider(source.kind):
                    raise ValidationError(
                        "kind",
                        "no connector for this source kind is available yet",
                    )
                source_id = source.id

            await enqueue_job(SYNC_IDENTITY_SOURCE, str(source_id))
            return pb.TriggerDirectorySyncResponse(enqueued=True)
        except ConnectError:
            raise
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except (ValidationError, ValueError) as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            logger.exception(f"Error triggering directory sync: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
