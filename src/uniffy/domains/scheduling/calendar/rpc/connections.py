"""Google and Microsoft calendar connection RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.cal.v1.connections_pb import (
    CompleteCalendarConnectionRequest,
    CompleteCalendarConnectionResponse,
    DisconnectCalendarConnectionRequest,
    DisconnectCalendarConnectionResponse,
    GetCalendarProviderSettingsRequest,
    GetCalendarProviderSettingsResponse,
    ListCalendarConnectionsRequest,
    ListCalendarConnectionsResponse,
    PauseCalendarConnectionRequest,
    PauseCalendarConnectionResponse,
    ProviderAppSettings,
    ProviderAvailability,
    ResumeCalendarConnectionRequest,
    ResumeCalendarConnectionResponse,
    StartCalendarConnectionRequest,
    StartCalendarConnectionResponse,
    SyncCalendarConnectionNowRequest,
    SyncCalendarConnectionNowResponse,
    UpdateCalendarProviderSettingsRequest,
    UpdateCalendarProviderSettingsResponse,
    UpdateConnectedCalendarRequest,
    UpdateConnectedCalendarResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.models.calendar.connection import CalendarProvider
from uniffy.domains.scheduling.calendar.connections import operations as connections
from uniffy.domains.scheduling.calendar.connections.clients import redirect_uri
from uniffy.domains.scheduling.calendar.connections.converters import (
    DIRECTION_FROM_PROTO,
    PROVIDER_FROM_PROTO,
    PROVIDER_TO_PROTO,
    SOURCE_TO_PROTO,
    connection_to_proto,
)
from uniffy.domains.scheduling.calendar.connections.credentials import (
    clear_provider_credentials,
    provider_app_views,
    resolve_provider_credentials,
    set_provider_credentials,
)
from uniffy.domains.scheduling.calendar.connections.oauth import (
    complete_connection,
    start_connection,
)
from uniffy.domains.scheduling.calendar.jobs.connections import wake
from uniffy.domains.scheduling.calendar.jobs.contracts import (
    DISCOVER_CONNECTION_CALENDARS,
    SYNC_CONNECTED_CALENDAR,
)
from uniffy.domains.scheduling.calendar.rpc.support import map_domain_error, parse_uuid
from uniffy.infrastructure.database import open_session


def _provider(value: int) -> CalendarProvider:
    provider = PROVIDER_FROM_PROTO.get(value)
    if provider is None:
        raise ConnectError(Code.INVALID_ARGUMENT, "provider is required")
    return provider


async def _connection_message(
    session: AsyncSession, user_id: UUID, organization_id: UUID, connection_id: UUID
):
    view = await connections.get_view(session, user_id, organization_id, connection_id)
    return connection_to_proto(view)


async def _wake_syncs(connected_ids: list[UUID], generation: int) -> None:
    for connected_id in connected_ids:
        await wake(SYNC_CONNECTED_CALENDAR, connected_id, generation)


class ConnectionHandlers:
    async def list_calendar_connections(
        self, request: ListCalendarConnectionsRequest, ctx: RequestContext
    ) -> ListCalendarConnectionsResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        try:
            async with open_session() as session:
                views, policy, can_connect = await connections.list_connections(
                    session, user_id, organization_id
                )
                providers = []
                for provider in CalendarProvider:
                    credentials = await resolve_provider_credentials(
                        session, organization_id, provider
                    )
                    providers.append(
                        ProviderAvailability(
                            provider=PROVIDER_TO_PROTO[provider],
                            configured=credentials is not None,
                            credential_source=SOURCE_TO_PROTO[
                                credentials.source if credentials else None
                            ],
                            writes_enabled=policy.provider_writes_enabled(),
                        )
                    )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_calendar_connections", exc) from exc
        return ListCalendarConnectionsResponse(
            connections=[connection_to_proto(view) for view in views],
            providers=providers,
            can_connect=can_connect,
        )

    async def start_calendar_connection(
        self, request: StartCalendarConnectionRequest, ctx: RequestContext
    ) -> StartCalendarConnectionResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        provider = _provider(request.provider)
        reconnect = (
            parse_uuid(request.reconnect_connection_id, "reconnect_connection_id")
            if request.has_field("reconnect_connection_id")
            else None
        )
        try:
            async with open_session() as session:
                url = await start_connection(
                    session,
                    user_id,
                    organization_id,
                    provider,
                    reconnect_connection_id=reconnect,
                    return_path=request.return_path,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("start_calendar_connection", exc) from exc
        return StartCalendarConnectionResponse(authorize_url=url)

    async def complete_calendar_connection(
        self, request: CompleteCalendarConnectionRequest, ctx: RequestContext
    ) -> CompleteCalendarConnectionResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        try:
            async with open_session() as session:
                completed = await complete_connection(
                    session,
                    user_id,
                    organization_id,
                    code=request.code,
                    state=request.state,
                    error=request.error,
                    error_description=request.error_description,
                )
                view = await connections.get_view(
                    session, user_id, organization_id, completed.connection_id
                )
                generation = view.connection.generation
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("complete_calendar_connection", exc) from exc
        await wake(DISCOVER_CONNECTION_CALENDARS, completed.connection_id, generation)
        return CompleteCalendarConnectionResponse(
            connection=connection_to_proto(view), return_path=completed.return_path
        )

    async def update_connected_calendar(
        self, request: UpdateConnectedCalendarRequest, ctx: RequestContext
    ) -> UpdateConnectedCalendarResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        connected_id = parse_uuid(request.connected_calendar_id, "connected_calendar_id")
        direction = None
        if request.has_field("direction"):
            direction = DIRECTION_FROM_PROTO.get(request.direction)
            if direction is None:
                raise ConnectError(Code.INVALID_ARGUMENT, "direction is not valid")
        try:
            async with open_session() as session:
                connection_id = await connections.update_connected_calendar(
                    session,
                    user_id,
                    organization_id,
                    connected_id,
                    sync_enabled=(
                        request.sync_enabled if request.has_field("sync_enabled") else None
                    ),
                    direction=direction,
                    counts_as_busy=(
                        request.counts_as_busy if request.has_field("counts_as_busy") else None
                    ),
                )
                view = await connections.get_view(session, user_id, organization_id, connection_id)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_connected_calendar", exc) from exc
        if request.has_field("sync_enabled") and request.sync_enabled:
            await wake(SYNC_CONNECTED_CALENDAR, connected_id, view.connection.generation)
        return UpdateConnectedCalendarResponse(connection=connection_to_proto(view))

    async def pause_calendar_connection(
        self, request: PauseCalendarConnectionRequest, ctx: RequestContext
    ) -> PauseCalendarConnectionResponse:
        message = await self._set_paused(request.organization_id, request.connection_id, True)
        return PauseCalendarConnectionResponse(connection=message)

    async def resume_calendar_connection(
        self, request: ResumeCalendarConnectionRequest, ctx: RequestContext
    ) -> ResumeCalendarConnectionResponse:
        message = await self._set_paused(request.organization_id, request.connection_id, False)
        return ResumeCalendarConnectionResponse(connection=message)

    async def _set_paused(self, organization: str, connection: str, paused: bool):
        user_id = current_user_id()
        organization_id = resolve_organization_id(organization)
        connection_id = parse_uuid(connection, "connection_id")
        try:
            async with open_session() as session:
                await connections.set_paused(
                    session, user_id, organization_id, connection_id, paused=paused
                )
                return await _connection_message(session, user_id, organization_id, connection_id)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("set_calendar_connection_paused", exc) from exc

    async def disconnect_calendar_connection(
        self, request: DisconnectCalendarConnectionRequest, ctx: RequestContext
    ) -> DisconnectCalendarConnectionResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        connection_id = parse_uuid(request.connection_id, "connection_id")
        try:
            async with open_session() as session:
                await connections.disconnect(session, user_id, organization_id, connection_id)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("disconnect_calendar_connection", exc) from exc
        return DisconnectCalendarConnectionResponse()

    async def sync_calendar_connection_now(
        self, request: SyncCalendarConnectionNowRequest, ctx: RequestContext
    ) -> SyncCalendarConnectionNowResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        connection_id = parse_uuid(request.connection_id, "connection_id")
        try:
            async with open_session() as session:
                woken = await connections.sync_now(session, user_id, organization_id, connection_id)
                view = await connections.get_view(session, user_id, organization_id, connection_id)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("sync_calendar_connection_now", exc) from exc
        await _wake_syncs(woken, view.connection.generation)
        return SyncCalendarConnectionNowResponse(connection=connection_to_proto(view))

    async def get_calendar_provider_settings(
        self, request: GetCalendarProviderSettingsRequest, ctx: RequestContext
    ) -> GetCalendarProviderSettingsResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        try:
            async with open_session() as session:
                providers = await _app_settings(session, user_id, organization_id)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_calendar_provider_settings", exc) from exc
        return GetCalendarProviderSettingsResponse(providers=providers, redirect_uri=redirect_uri())

    async def update_calendar_provider_settings(
        self, request: UpdateCalendarProviderSettingsRequest, ctx: RequestContext
    ) -> UpdateCalendarProviderSettingsResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        provider = _provider(request.provider)
        try:
            async with open_session() as session:
                if request.clear:
                    await clear_provider_credentials(session, user_id, organization_id, provider)
                else:
                    await set_provider_credentials(
                        session,
                        user_id,
                        organization_id,
                        provider,
                        client_id=request.client_id,
                        client_secret=request.client_secret,
                        tenant=request.tenant,
                    )
                providers = await _app_settings(session, user_id, organization_id)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_calendar_provider_settings", exc) from exc
        return UpdateCalendarProviderSettingsResponse(
            providers=providers, redirect_uri=redirect_uri()
        )


async def _app_settings(
    session: AsyncSession, user_id: UUID, organization_id: UUID
) -> list[ProviderAppSettings]:
    return [
        ProviderAppSettings(
            provider=PROVIDER_TO_PROTO[view.provider],
            source=SOURCE_TO_PROTO[view.source],
            client_id=view.client_id,
            client_secret_hint=view.secret_hint,
            tenant=view.tenant,
            deployment_configured=view.deployment_configured,
        )
        for view in await provider_app_views(session, user_id, organization_id)
    ]
