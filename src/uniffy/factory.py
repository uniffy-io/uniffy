"""FastAPI application factory wiring ConnectRPC services and HTTP routes."""

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from loguru import logger
from starlette.types import ASGIApp, Receive, Scope, Send
from uniffy_proto.agents.v1.agents_connect import AgentsServiceASGIApplication
from uniffy_proto.agents.v1.budgets_connect import BudgetsServiceASGIApplication
from uniffy_proto.agents.v1.cron_connect import CronServiceASGIApplication
from uniffy_proto.agents.v1.memories_connect import MemoriesServiceASGIApplication
from uniffy_proto.agents.v1.providers_connect import ProvidersServiceASGIApplication
from uniffy_proto.agents.v1.rate_limits_connect import RateLimitsServiceASGIApplication
from uniffy_proto.agents.v1.runtime_connect import (
    RuntimeServiceASGIApplication,
    RuntimeSettingsServiceASGIApplication,
)
from uniffy_proto.agents.v1.sessions_connect import SessionsServiceASGIApplication
from uniffy_proto.agents.v1.skills_connect import SkillsServiceASGIApplication
from uniffy_proto.audit.v1.audit_connect import AuditServiceASGIApplication
from uniffy_proto.auth.v1.auth_connect import AuthServiceASGIApplication
from uniffy_proto.auth.v1.mfa_connect import MfaServiceASGIApplication
from uniffy_proto.bookmarks.v1.bookmarks_connect import BookmarksServiceASGIApplication
from uniffy_proto.cal.v1.calendar_connect import CalendarServiceASGIApplication
from uniffy_proto.calls.v1.calls_connect import CallServiceASGIApplication
from uniffy_proto.chat.v1.chat_connect import ChatServiceASGIApplication
from uniffy_proto.chat.v1.chat_stream_connect import ChatStreamServiceASGIApplication
from uniffy_proto.comments.v1.comments_connect import CommentsServiceASGIApplication
from uniffy_proto.files.v1.files_connect import FilesServiceASGIApplication
from uniffy_proto.groups.v1.groups_connect import GroupsServiceASGIApplication
from uniffy_proto.integrations.v1.integrations_connect import (
    IntegrationsServiceASGIApplication,
)
from uniffy_proto.mail.v1.mail_connect import OrgMailServiceASGIApplication
from uniffy_proto.notes.v1.notes_connect import NotesServiceASGIApplication
from uniffy_proto.notifications.v1.notifications_connect import NotificationsServiceASGIApplication
from uniffy_proto.organizations.v1.organizations_connect import OrganizationsServiceASGIApplication
from uniffy_proto.permissions.v1.permissions_connect import MembersServiceASGIApplication
from uniffy_proto.presence.v1.presence_connect import PresenceServiceASGIApplication
from uniffy_proto.projects.v1.projects_connect import ProjectsServiceASGIApplication
from uniffy_proto.rooms.v1.rooms_connect import RoomsServiceASGIApplication
from uniffy_proto.search.v1.search_connect import SearchServiceASGIApplication
from uniffy_proto.settings.v1.settings_connect import SettingsServiceASGIApplication
from uniffy_proto.superadmin.v1.platform_audit_connect import (
    PlatformAuditServiceASGIApplication,
)
from uniffy_proto.superadmin.v1.support_session_connect import (
    SupportServiceASGIApplication,
)
from uniffy_proto.superadmin.v1.system_config_connect import (
    SystemConfigServiceASGIApplication,
)
from uniffy_proto.superadmin.v1.system_directory_connect import (
    SystemOrganizationsServiceASGIApplication,
    SystemUsersServiceASGIApplication,
)
from uniffy_proto.superadmin.v1.system_encryption_connect import (
    SystemEncryptionServiceASGIApplication,
)
from uniffy_proto.superadmin.v1.system_mail_connect import SystemMailServiceASGIApplication
from uniffy_proto.tags.v1.tags_connect import TagsServiceASGIApplication
from uniffy_proto.users.v1.users_connect import UsersServiceASGIApplication

from uniffy.core.audit import RequestContextMiddleware as AuditRequestContextMiddleware
from uniffy.core.crypto import (
    DeploymentCipher,
    close_dek_invalidation_subscriber,
    close_deployment_dek_invalidation_subscriber,
    subscribe_dek_invalidations,
    subscribe_deployment_dek_invalidations,
)
from uniffy.core.realtime import realtime_router
from uniffy.core.realtime.router import router as realtime_pubsub_router
from uniffy.core.search import close_meilisearch, init_meilisearch
from uniffy.core.storage.s3_client import close_s3, init_s3
from uniffy.core.streaming.middleware import StreamRevokeWatchMiddleware
from uniffy.core.streaming.revoke_coordinator import coordinator as stream_revoke_coordinator
from uniffy.core.valkey import (
    close_ops_client,
    close_pubsub,
    close_queue,
    close_streams_client,
    init_ops_client,
    init_pubsub,
    init_queue,
    init_streams_client,
    signal_pubsub_shutdown,
)
from uniffy.core.webhooks import register_webhook_provider, webhooks_router
from uniffy.db import (
    close_db,
    init_db,
    open_session,
    seed_initial_data,
    sync_bundled_skills,
)
from uniffy.domains.agents.agents.http_routes import agent_avatars_router
from uniffy.domains.agents.agents.service import AgentsServiceImpl
from uniffy.domains.agents.budgets.service import BudgetsServiceImpl
from uniffy.domains.agents.cron.service import CronServiceImpl
from uniffy.domains.agents.memories.service import MemoriesServiceImpl
from uniffy.domains.agents.providers.client_cache import (
    close_provider_invalidation_subscriber,
    init_provider_invalidation_subscriber,
)
from uniffy.domains.agents.providers.service import ProvidersServiceImpl
from uniffy.domains.agents.rate_limits.service import RateLimitsServiceImpl
from uniffy.domains.agents.runtime.service import RuntimeServiceImpl
from uniffy.domains.agents.runtime.settings_handlers import (
    RuntimeSettingsServiceImpl,
)
from uniffy.domains.agents.sessions.service import SessionsServiceImpl
from uniffy.domains.agents.skills.service import SkillsServiceImpl
from uniffy.domains.audit.service import AuditServiceImpl
from uniffy.domains.auth.interceptors import (
    AuthenticationInterceptor,
    AuthRevocationInterceptor,
)
from uniffy.domains.auth.mfa.service import MfaServiceImpl
from uniffy.domains.auth.service import AuthServiceImpl
from uniffy.domains.bookmarks.service import BookmarksServiceImpl
from uniffy.domains.calendar.service import CalendarServiceImpl
from uniffy.domains.calls.config import LiveKitConfigError
from uniffy.domains.calls.service import CallServiceImpl
from uniffy.domains.calls.webhook import LiveKitWebhookProvider
from uniffy.domains.chat.service import ChatServiceImpl
from uniffy.domains.chat.streaming.service import ChatStreamServiceImpl
from uniffy.domains.comments.service import CommentsServiceImpl
from uniffy.domains.files.http_routes import (
    files_router,
    media_router,
    thumbnails_router,
)
from uniffy.domains.files.service import FilesServiceImpl
from uniffy.domains.groups.service import GroupsServiceImpl
from uniffy.domains.integrations.client_cache import (
    close_integration_invalidation_subscriber,
    init_integration_invalidation_subscriber,
)
from uniffy.domains.integrations.service import IntegrationsServiceImpl
from uniffy.domains.mail.service import OrgMailServiceImpl
from uniffy.domains.mail.system_service import SystemMailServiceImpl
from uniffy.domains.notes.service import NotesServiceImpl
from uniffy.domains.notifications.middleware import StreamDisconnectMiddleware
from uniffy.domains.notifications.service import NotificationsServiceImpl
from uniffy.domains.organizations.service import OrganizationsServiceImpl
from uniffy.domains.permissions.service import MembersServiceImpl
from uniffy.domains.platform.audit.service import PlatformAuditServiceImpl
from uniffy.domains.platform.directory.service import (
    SystemOrganizationsServiceImpl,
    SystemUsersServiceImpl,
)
from uniffy.domains.platform.support_session.service import SupportServiceImpl
from uniffy.domains.presence.service import PresenceServiceImpl
from uniffy.domains.projects.service import ProjectsServiceImpl
from uniffy.domains.rooms.service import RoomsServiceImpl
from uniffy.domains.search.service import SearchServiceImpl
from uniffy.domains.settings.service import SettingsServiceImpl
from uniffy.domains.system_config.service import SystemConfigServiceImpl
from uniffy.domains.system_encryption.service import SystemEncryptionServiceImpl
from uniffy.domains.tags.service import TagsServiceImpl
from uniffy.domains.users.http_routes import avatars_router
from uniffy.domains.users.service import UsersServiceImpl
from uniffy.observability import ObservabilityConfig, setup_observability
from uniffy.observability.crpc import LoggingInterceptor, http_version_var
from uniffy.observability.fastapi.logger import setup_request_logging
from uniffy.observability.metrics import get_metrics
from uniffy.observability.otel import instrument_fastapi


class HttpVersionMiddleware:
    """Raw ASGI: BaseHTTPMiddleware's anyio channel wrapping breaks long-lived server streaming."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            http_version_var.set(scope.get("http_version", "unknown"))
        await self.app(scope, receive, send)


class SecurityHeadersMiddleware:
    """Raw ASGI so it composes with long-lived streaming responses."""

    _STATIC_HEADERS: tuple[tuple[bytes, bytes], ...] = (
        (b"strict-transport-security", b"max-age=63072000; includeSubDomains; preload"),
        (b"x-content-type-options", b"nosniff"),
        (b"x-frame-options", b"SAMEORIGIN"),
        (b"content-security-policy", b"frame-ancestors 'self'"),
        (b"cross-origin-opener-policy", b"same-origin"),
        (b"cross-origin-resource-policy", b"same-origin"),
        (b"referrer-policy", b"no-referrer"),
        (b"server", b"uniffy"),
    )

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: dict) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                existing = {name.lower() for name, _ in headers}
                for name, value in self._STATIC_HEADERS:
                    if name not in existing:
                        headers.append((name, value))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_wrapper)


class ConnectRPCDispatcher:
    """ASGI dispatcher routing requests to ConnectRPC services by path prefix."""

    def __init__(self) -> None:
        self.services: list[tuple[str, ASGIApp]] = []
        self.fallback: ASGIApp | None = None

    def add_service(self, prefix: str, app: ASGIApp) -> None:
        self.services.append((prefix, app))

    def set_fallback(self, app: ASGIApp) -> None:
        self.fallback = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            return

        path = scope.get("path", "")
        root_path = scope.get("root_path", "")

        # FastAPI's mount() sets root_path without stripping the prefix from path.
        if root_path and path.startswith(root_path):
            path = path[len(root_path) :] or "/"

        for prefix, service_app in self.services:
            if path.startswith(prefix):
                service_scope = dict(scope)
                service_scope["path"] = path
                await service_app(service_scope, receive, send)
                return

        if self.fallback is not None:
            fallback_scope = dict(scope)
            fallback_scope["path"] = path
            await self.fallback(fallback_scope, receive, send)
            return

        if scope["type"] == "http":
            await send({"type": "http.response.start", "status": 404, "headers": []})
            await send({"type": "http.response.body", "body": b"Not Found"})


def _setup_observability() -> None:
    environment = os.getenv("ENVIRONMENT", "development")
    log_level = os.getenv("LOG_LEVEL", "info").upper()

    setup_observability(
        config=ObservabilityConfig(
            app_name="uniffy",
            app_version="0.1.0",
            environment=environment,
            console_log_level=log_level,
            console_log_type=os.getenv("LOG_FORMAT", "console").lower(),
        )
    )


def _get_cors_origins() -> list[str]:
    """Resolve the CORS allowlist; refuses ``*`` outside ``development``.

    Wildcard with ``allow_credentials=True`` is widely misunderstood: browsers
    accept the echoed origin, so the practical effect is "any origin can issue
    authenticated requests once a user has a session there". On a production
    deployment that disables Origin-based defenses entirely, so we require an
    explicit list.
    """
    raw = os.getenv("CORS_ORIGINS", "")
    environment = os.getenv("ENVIRONMENT", "development").lower()
    if not raw:
        if environment == "development":
            return ["http://localhost:5173", "http://localhost:3000", "http://localhost:8080"]
        raise RuntimeError(
            "CORS_ORIGINS must be set to an explicit comma-separated list "
            "outside development (e.g. https://app.example.com)"
        )
    if raw.strip() == "*":
        if environment == "development":
            return ["*"]
        raise RuntimeError(
            "CORS_ORIGINS='*' is not permitted with allow_credentials=True; "
            "set an explicit origin list."
        )
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting UNIFFY application...")

    try:
        await init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.exception(f"Failed to initialize database: {e}")
        raise

    try:
        await init_meilisearch()
        logger.info("Meilisearch initialized successfully")
    except Exception as e:
        logger.exception(f"Failed to initialize Meilisearch: {e}")
        raise

    try:
        await init_s3()
        logger.info("S3 storage initialized successfully")
    except Exception as e:
        logger.exception(f"Failed to initialize S3 storage: {e}")
        raise

    try:
        await init_queue("core")
        logger.info("Core job queue initialized successfully")
    except Exception as e:
        logger.warning(f"Core job queue not available: {e}")

    try:
        await init_queue("egress")
        logger.info("Egress job queue initialized successfully")
    except Exception as e:
        logger.warning(f"Egress job queue not available: {e}")

    try:
        await init_pubsub()
        logger.info("Pub/Sub initialized successfully")
    except Exception as e:
        logger.warning(f"Pub/Sub not available: {e}")

    # A Valkey outage at boot makes every cache read a miss; the app still serves.
    try:
        await init_ops_client()
        logger.info("Valkey ops client initialized successfully")
    except Exception as e:
        logger.warning(f"Valkey ops client not available: {e}")

    try:
        await init_streams_client()
        logger.info("Valkey streams client initialized successfully")
    except Exception as e:
        logger.warning(f"Valkey streams client not available: {e}")

    try:
        await init_provider_invalidation_subscriber()
    except Exception as e:
        logger.warning(f"Provider invalidation subscriber not available: {e}")

    try:
        await init_integration_invalidation_subscriber()
    except Exception as e:
        logger.warning(f"Integration invalidation subscriber not available: {e}")

    try:
        await subscribe_dek_invalidations()
    except Exception as e:
        logger.warning(f"Org DEK invalidation subscriber not available: {e}")

    try:
        await subscribe_deployment_dek_invalidations()
    except Exception as e:
        logger.warning(f"Deployment DEK invalidation subscriber not available: {e}")

    try:
        from uniffy.core.realtime import ydoc_manager as _rt_manager  # noqa: F401

        await realtime_pubsub_router.start()
        logger.info("Realtime router started successfully")
    except Exception as e:
        logger.warning(f"Realtime router not available: {e}")

    try:
        await stream_revoke_coordinator.start()
        logger.info("Stream revoke coordinator started successfully")
    except Exception as e:
        logger.warning(f"Stream revoke coordinator not available: {e}")

    # Ahead of the seed: the bootstrapped default agent resolves bundled skills
    # by id, so the rows have to exist before the first organization is created.
    try:
        await sync_bundled_skills()
    except Exception as e:
        logger.exception(f"Failed to sync bundled skills: {e}")
        raise

    try:
        await seed_initial_data()
        logger.info("Initial data seeded successfully")
    except Exception as e:
        logger.exception(f"Failed to seed initial data: {e}")
        raise

    try:
        async with open_session() as session:
            version = await DeploymentCipher(session).provision_if_missing()
            logger.info(f"Deployment DEK active at v{version}")
    except Exception as e:
        logger.exception(f"Deployment DEK provisioning failed: {e}")
        raise

    try:
        from uniffy.core.config.push import load_vapid_config

        await load_vapid_config()
    except Exception as e:
        logger.warning(f"VAPID config not available: {e}")

    yield

    logger.info("Shutting down UNIFFY application...")
    await stream_revoke_coordinator.stop()
    await realtime_pubsub_router.stop()
    signal_pubsub_shutdown()
    await close_provider_invalidation_subscriber()
    await close_integration_invalidation_subscriber()
    await close_dek_invalidation_subscriber()
    await close_deployment_dek_invalidation_subscriber()
    await close_streams_client()
    await close_ops_client()
    await close_pubsub()
    await close_queue("core")
    await close_queue("egress")
    await close_s3()
    await close_meilisearch()
    await close_db()


def create_app() -> FastAPI:
    _setup_observability()

    app = FastAPI(
        title="UNIFFY - Unified Work Operating System",
        description="The Operating System for Work",
        version="0.1.0",
        lifespan=lifespan,
    )

    cors_origins = _get_cors_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )
    app.add_middleware(HttpVersionMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(AuditRequestContextMiddleware)

    api_dispatcher = _create_api_dispatcher()
    app.mount("/api", api_dispatcher)

    # Signature-verified inbound webhooks; reached directly on the internal
    # network, never proxied by the edge.
    try:
        register_webhook_provider("livekit", LiveKitWebhookProvider())
    except LiveKitConfigError as exc:
        logger.warning(f"LiveKit not configured, calls disabled: {exc}")
    app.include_router(webhooks_router)

    @app.get("/healthz")
    async def health_check():
        return {"status": "ok", "service": "uniffy"}

    @app.get("/metrics")
    async def metrics():
        return Response(content=get_metrics(), media_type="text/plain; version=0.0.4; charset=utf-8")

    instrument_fastapi(app=app, exclude_paths=["/healthz", "/metrics"])

    logger.info(f"CORS allowed origins: {cors_origins}")
    return app


def _create_api_dispatcher() -> ConnectRPCDispatcher:
    logging_interceptor = LoggingInterceptor()
    # AuthenticationInterceptor runs FIRST and denies by default, so a handler
    # that forgets its own identity check is not reachable without a token.
    # Revocation follows, so a revoked access token never reaches handler code.
    # LoggingInterceptor still gets the access log line because ConnectRPC
    # unwinds interceptors in reverse order on raise.
    authentication_interceptor = AuthenticationInterceptor()
    auth_revocation_interceptor = AuthRevocationInterceptor()
    interceptors = [
        authentication_interceptor,
        auth_revocation_interceptor,
        logging_interceptor,
    ]
    dispatcher = ConnectRPCDispatcher()

    dispatcher.add_service(
        "/auth.v1.AuthService",
        AuthServiceASGIApplication(AuthServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/auth.v1.MfaService",
        MfaServiceASGIApplication(MfaServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/notes.v1.NotesService",
        NotesServiceASGIApplication(NotesServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/search.v1.SearchService",
        SearchServiceASGIApplication(SearchServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/settings.v1.SettingsService",
        SettingsServiceASGIApplication(SettingsServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/bookmarks.v1.BookmarksService",
        BookmarksServiceASGIApplication(BookmarksServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/tags.v1.TagsService",
        TagsServiceASGIApplication(TagsServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/chat.v1.ChatService",
        ChatServiceASGIApplication(ChatServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/chat.v1.ChatStreamService",
        StreamDisconnectMiddleware(
            StreamRevokeWatchMiddleware(
                ChatStreamServiceASGIApplication(ChatStreamServiceImpl(), interceptors=interceptors)
            )
        ),
    )
    dispatcher.add_service(
        "/permissions.v1.MembersService",
        MembersServiceASGIApplication(MembersServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/presence.v1.PresenceService",
        PresenceServiceASGIApplication(PresenceServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/users.v1.UsersService",
        UsersServiceASGIApplication(UsersServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/organizations.v1.OrganizationsService",
        OrganizationsServiceASGIApplication(OrganizationsServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/groups.v1.GroupsService",
        GroupsServiceASGIApplication(GroupsServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/cal.v1.CalendarService",
        CalendarServiceASGIApplication(CalendarServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/files.v1.FilesService",
        FilesServiceASGIApplication(FilesServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/audit.v1.AuditService",
        AuditServiceASGIApplication(AuditServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/mail.v1.OrgMailService",
        OrgMailServiceASGIApplication(OrgMailServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/superadmin.v1.SystemMailService",
        SystemMailServiceASGIApplication(SystemMailServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/superadmin.v1.SystemEncryptionService",
        SystemEncryptionServiceASGIApplication(
            SystemEncryptionServiceImpl(), interceptors=interceptors
        ),
    )
    dispatcher.add_service(
        "/superadmin.v1.SystemConfigService",
        SystemConfigServiceASGIApplication(SystemConfigServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/superadmin.v1.SystemOrganizationsService",
        SystemOrganizationsServiceASGIApplication(
            SystemOrganizationsServiceImpl(), interceptors=interceptors
        ),
    )
    dispatcher.add_service(
        "/superadmin.v1.SystemUsersService",
        SystemUsersServiceASGIApplication(SystemUsersServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/superadmin.v1.SupportService",
        SupportServiceASGIApplication(SupportServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/superadmin.v1.PlatformAuditService",
        PlatformAuditServiceASGIApplication(PlatformAuditServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/comments.v1.CommentsService",
        CommentsServiceASGIApplication(CommentsServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/notifications.v1.NotificationsService",
        StreamDisconnectMiddleware(
            StreamRevokeWatchMiddleware(
                NotificationsServiceASGIApplication(
                    NotificationsServiceImpl(), interceptors=interceptors
                )
            )
        ),
    )
    dispatcher.add_service(
        "/projects.v1.ProjectsService",
        ProjectsServiceASGIApplication(ProjectsServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/rooms.v1.RoomsService",
        RoomsServiceASGIApplication(RoomsServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/calls.v1.CallService",
        CallServiceASGIApplication(CallServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/integrations.v1.IntegrationsService",
        IntegrationsServiceASGIApplication(IntegrationsServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/agents.v1.ProvidersService",
        ProvidersServiceASGIApplication(ProvidersServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/agents.v1.SessionsService",
        SessionsServiceASGIApplication(SessionsServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/agents.v1.AgentsService",
        AgentsServiceASGIApplication(AgentsServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/agents.v1.SkillsService",
        SkillsServiceASGIApplication(SkillsServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/agents.v1.MemoriesService",
        MemoriesServiceASGIApplication(MemoriesServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/agents.v1.CronService",
        CronServiceASGIApplication(CronServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/agents.v1.BudgetsService",
        BudgetsServiceASGIApplication(BudgetsServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/agents.v1.RateLimitsService",
        RateLimitsServiceASGIApplication(RateLimitsServiceImpl(), interceptors=interceptors),
    )
    dispatcher.add_service(
        "/agents.v1.RuntimeService",
        StreamDisconnectMiddleware(
            StreamRevokeWatchMiddleware(
                RuntimeServiceASGIApplication(RuntimeServiceImpl(), interceptors=interceptors)
            )
        ),
    )
    dispatcher.add_service(
        "/agents.v1.RuntimeSettingsService",
        RuntimeSettingsServiceASGIApplication(
            RuntimeSettingsServiceImpl(), interceptors=interceptors
        ),
    )

    http_app = FastAPI()
    setup_request_logging(http_app)
    http_app.include_router(thumbnails_router)
    http_app.include_router(files_router)
    http_app.include_router(media_router)
    http_app.include_router(avatars_router)
    http_app.include_router(agent_avatars_router)
    http_app.include_router(realtime_router)
    dispatcher.add_service("/thumbnails", http_app)
    dispatcher.add_service("/files", http_app)
    dispatcher.add_service("/media", http_app)
    dispatcher.add_service("/avatars", http_app)
    dispatcher.add_service("/agents/avatars", http_app)
    dispatcher.add_service("/realtime", http_app)

    return dispatcher
