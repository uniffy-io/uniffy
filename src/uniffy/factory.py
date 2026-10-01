"""FastAPI application factory wiring ConnectRPC services and HTTP routes."""

import os
from collections.abc import Callable
from contextlib import asynccontextmanager

from connectrpc.server import DEFAULT_READ_MAX_BYTES
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
from uniffy_proto.agents.v1.rules_connect import RulesServiceASGIApplication
from uniffy_proto.agents.v1.runtime_connect import (
    RuntimeServiceASGIApplication,
    RuntimeSettingsServiceASGIApplication,
)
from uniffy_proto.agents.v1.sessions_connect import SessionsServiceASGIApplication
from uniffy_proto.agents.v1.skill_evaluations_connect import SkillEvaluationsServiceASGIApplication
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
from uniffy_proto.people.v1.people_connect import PeopleServiceASGIApplication
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
from uniffy_proto.superadmin.v1.system_mfa_connect import SystemMfaServiceASGIApplication
from uniffy_proto.support.v1.support_consent_connect import (
    SupportConsentServiceASGIApplication,
)
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
from uniffy.core.jobs import QueueName
from uniffy.core.realtime import realtime_router
from uniffy.core.realtime.router import router as realtime_pubsub_router
from uniffy.core.search import SearchIndexer, WorkspaceSearch
from uniffy.core.search.engine import SearchEngine
from uniffy.core.storage import ObjectStorage
from uniffy.core.streaming.disconnect import StreamDisconnectMiddleware
from uniffy.core.streaming.middleware import StreamRevokeWatchMiddleware
from uniffy.core.streaming.revoke_coordinator import coordinator as stream_revoke_coordinator
from uniffy.core.webhooks import register_webhook_provider, webhooks_router
from uniffy.domains.agents.agents.routes import create_agent_avatars_router
from uniffy.domains.agents.agents.service import AgentsServiceImpl
from uniffy.domains.agents.budgets.handlers import BudgetsHandlers
from uniffy.domains.agents.cron.service import CronServiceImpl
from uniffy.domains.agents.limits.handlers import RateLimitsHandlers
from uniffy.domains.agents.memories.handlers import MemoriesHandlers
from uniffy.domains.agents.providers.clients import (
    close_provider_invalidation_subscriber,
    init_provider_invalidation_subscriber,
)
from uniffy.domains.agents.providers.handlers import ProvidersHandlers
from uniffy.domains.agents.rules.bundled import sync_bundled_rules
from uniffy.domains.agents.rules.handlers import RulesHandlers
from uniffy.domains.agents.runtime.service import RuntimeServiceImpl
from uniffy.domains.agents.runtime.settings.handlers import (
    RuntimeSettingsServiceImpl,
)
from uniffy.domains.agents.sessions.handlers import SessionsHandlers
from uniffy.domains.agents.skills.bundled import sync_bundled_skills
from uniffy.domains.agents.skills.evaluations.handlers import SkillEvaluationHandlers
from uniffy.domains.agents.skills.handlers import SkillsHandlers
from uniffy.domains.audit.service import AuditServiceImpl
from uniffy.domains.auth.handlers import AuthHandlers
from uniffy.domains.auth.interceptors import AuthenticationInterceptor
from uniffy.domains.auth.mfa.handlers import MfaHandlers
from uniffy.domains.auth.mfa.operations import MfaOperations
from uniffy.domains.bookmarks.service import BookmarksServiceImpl
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.calls.config import LiveKitConfigError
from uniffy.domains.calls.handlers import CallHandlers
from uniffy.domains.calls.webhook import LiveKitWebhookProvider
from uniffy.domains.chat.service import ChatServiceImpl
from uniffy.domains.chat.streaming.handlers import ChatStreamHandlers
from uniffy.domains.comments.handlers import CommentsHandlers
from uniffy.domains.directory.groups.service import GroupsServiceImpl
from uniffy.domains.directory.people.service import PeopleServiceImpl
from uniffy.domains.files.registration import register_file_content
from uniffy.domains.files.routes import create_file_routers
from uniffy.domains.files.service import FilesServiceImpl
from uniffy.domains.integrations.clients import (
    close_integration_invalidation_subscriber,
    init_integration_invalidation_subscriber,
)
from uniffy.domains.integrations.handlers import IntegrationsHandlers
from uniffy.domains.mail.service import OrgMailServiceImpl
from uniffy.domains.mail.system.service import SystemMailServiceImpl
from uniffy.domains.notes.adapter import register_note_realtime_adapter
from uniffy.domains.notes.registration import register_note_content
from uniffy.domains.notes.service import NotesServiceImpl
from uniffy.domains.notifications.handlers import NotificationsHandlers
from uniffy.domains.organizations.service import OrganizationsServiceImpl
from uniffy.domains.permissions.service import MembersServiceImpl
from uniffy.domains.platform.audit.service import PlatformAuditServiceImpl
from uniffy.domains.platform.bootstrap import bootstrap_deployment
from uniffy.domains.platform.config.service import SystemConfigServiceImpl
from uniffy.domains.platform.directory.service import (
    SystemOrganizationsServiceImpl,
    SystemUsersServiceImpl,
)
from uniffy.domains.platform.encryption.service import SystemEncryptionServiceImpl
from uniffy.domains.platform.mfa.handlers import SystemMfaHandlers
from uniffy.domains.platform.support.consent import (
    SupportConsentServiceImpl,
)
from uniffy.domains.platform.support.service import SupportServiceImpl
from uniffy.domains.presence.handlers import PresenceHandlers
from uniffy.domains.projects.realtime import register_task_realtime_adapter
from uniffy.domains.projects.registration import register_project_content
from uniffy.domains.projects.service import ProjectsServiceImpl
from uniffy.domains.scheduling.calendar.events.registration import register_calendar_content
from uniffy.domains.scheduling.calendar.ical.feed import register_calendar_crypto
from uniffy.domains.scheduling.calendar.realtime import register_event_realtime_adapter
from uniffy.domains.scheduling.calendar.routes import create_calendar_router
from uniffy.domains.scheduling.calendar.service import CalendarServiceImpl
from uniffy.domains.scheduling.rooms.service import RoomsServiceImpl
from uniffy.domains.search.service import SearchServiceImpl
from uniffy.domains.settings.handlers import SettingsHandlers
from uniffy.domains.tags.service import TagsServiceImpl
from uniffy.domains.users.routes import create_avatars_router
from uniffy.domains.users.service import UsersServiceImpl
from uniffy.infrastructure.database import close_db, init_db, open_session
from uniffy.infrastructure.database.metrics import update_pool_metrics
from uniffy.infrastructure.observability.config import LoggingConfig
from uniffy.infrastructure.observability.logger import configure_logging
from uniffy.infrastructure.observability.prometheus import get_metrics
from uniffy.infrastructure.search import MeiliSearchEngine
from uniffy.infrastructure.storage import S3Storage
from uniffy.infrastructure.valkey.ops import close_ops_client, init_ops_client
from uniffy.infrastructure.valkey.pubsub import (
    close_pubsub,
    init_pubsub,
    signal_pubsub_shutdown,
)
from uniffy.infrastructure.valkey.queue import close_queue, init_queue
from uniffy.infrastructure.valkey.streams import close_streams_client, init_streams_client
from uniffy.transport.http import setup_request_logging
from uniffy.transport.rpc import LoggingInterceptor, http_version_var, strict_request_codecs

# JSON adds base64 overhead to 5 MiB avatars, 10 MiB imports, and 50 MiB chunks.
AVATAR_RPC_READ_MAX_BYTES = 8 * 1024**2
CALENDAR_RPC_READ_MAX_BYTES = 16 * 1024**2
FILES_RPC_READ_MAX_BYTES = 72 * 1024**2


class HttpVersionMiddleware:
    """Raw ASGI: BaseHTTPMiddleware's anyio channel wrapping breaks long-lived server streaming."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":  # noqa: PLR2004
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
        if scope["type"] != "http":  # noqa: PLR2004
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: dict) -> None:
            if message["type"] == "http.response.start":  # noqa: PLR2004
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
        if any(registered_prefix == prefix for registered_prefix, _ in self.services):
            raise ValueError(f"Duplicate service prefix: {prefix}")
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
            if path == prefix or path.startswith(f"{prefix}/"):
                service_scope = dict(scope)
                service_scope["path"] = path
                await service_app(service_scope, receive, send)
                return

        if self.fallback is not None:
            fallback_scope = dict(scope)
            fallback_scope["path"] = path
            await self.fallback(fallback_scope, receive, send)
            return

        if scope["type"] == "http":  # noqa: PLR2004
            await send({"type": "http.response.start", "status": 404, "headers": []})
            await send({"type": "http.response.body", "body": b"Not Found"})


def _setup_logging() -> None:
    log_level = os.getenv("LOG_LEVEL", "info").upper()

    configure_logging(
        config=LoggingConfig(
            app_name="uniffy",
            app_version="0.1.0",
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
        if environment == "development":  # noqa: PLR2004
            return ["http://localhost:5173", "http://localhost:3000", "http://localhost:8080"]
        raise RuntimeError(
            "CORS_ORIGINS must be set to an explicit comma-separated list "
            "outside development (e.g. https://app.example.com)"
        )
    if raw.strip() == "*":  # noqa: PLR2004
        if environment == "development":  # noqa: PLR2004
            return ["*"]
        raise RuntimeError(
            "CORS_ORIGINS='*' is not permitted with allow_credentials=True; "
            "set an explicit origin list."
        )
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage: ObjectStorage = app.state.object_storage
    search: WorkspaceSearch = app.state.workspace_search
    search_indexer: SearchIndexer = app.state.search_indexer
    logger.info("Starting UNIFFY application...")

    try:
        await init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.exception(f"Failed to initialize database: {e}")
        raise

    try:
        await search.startup()
        logger.info("Search engine initialized successfully")
    except Exception as e:
        logger.exception(f"Failed to initialize search engine: {e}")
        raise

    try:
        await storage.startup()
        logger.info("S3 storage initialized successfully")
    except Exception as e:
        logger.exception(f"Failed to initialize S3 storage: {e}")
        raise

    try:
        await init_queue(QueueName.CORE)
        logger.info("Core job queue initialized successfully")
    except Exception as e:
        logger.warning(f"Core job queue not available: {e}")

    try:
        await init_queue(QueueName.EGRESS)
        logger.info("Egress job queue initialized successfully")
    except Exception as e:
        logger.warning(f"Egress job queue not available: {e}")

    try:
        await init_queue(QueueName.MEDIA)
        logger.info("Media job queue initialized")
    except Exception as e:
        logger.warning(f"Media job queue not available: {e}")

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

    # The bootstrapped default agent resolves bundled skills by id, so those
    # rows must exist before the first organization is created.
    try:
        await sync_bundled_skills()
        await sync_bundled_rules()
    except Exception as e:
        logger.exception(f"Failed to sync bundled skills: {e}")
        raise

    try:
        await bootstrap_deployment(search_indexer)
        logger.info("Deployment bootstrap completed successfully")
    except Exception as e:
        logger.exception(f"Deployment bootstrap failed: {e}")
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
    try:
        from uniffy.core.realtime.ydoc_manager import ydoc_manager

        await ydoc_manager.flush_all()
    except Exception as e:
        logger.warning(f"Realtime shutdown flush failed: {e}")
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
    await close_queue(QueueName.CORE)
    await close_queue(QueueName.EGRESS)
    await close_queue(QueueName.MEDIA)
    await storage.shutdown()
    await search.shutdown()
    await close_db()


def create_app(
    storage: ObjectStorage | None = None,
    search_engine: SearchEngine | None = None,
) -> FastAPI:
    storage = storage or S3Storage()
    search = WorkspaceSearch(search_engine or MeiliSearchEngine())
    search_indexer = SearchIndexer(search)
    register_note_realtime_adapter(search_indexer)
    register_task_realtime_adapter(search_indexer)
    register_event_realtime_adapter(search_indexer)
    register_note_content()
    register_calendar_content()
    register_calendar_crypto()
    register_file_content()
    register_project_content()
    _setup_logging()

    app = FastAPI(
        title="Uniffy",
        description="",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.object_storage = storage
    app.state.workspace_search = search
    app.state.search_indexer = search_indexer

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

    api_dispatcher = _create_api_dispatcher(storage, search, search_indexer)
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
        return Response(
            content=get_metrics((update_pool_metrics,)),
            media_type="text/plain; version=0.0.4; charset=utf-8",
        )

    logger.info(f"CORS allowed origins: {cors_origins}")
    return app


def _create_api_dispatcher(
    storage: ObjectStorage,
    search: WorkspaceSearch,
    search_indexer: SearchIndexer,
) -> ConnectRPCDispatcher:
    logging_interceptor = LoggingInterceptor()
    authentication_interceptor = AuthenticationInterceptor()
    interceptors = [
        authentication_interceptor,
        logging_interceptor,
    ]
    codecs = strict_request_codecs()
    dispatcher = ConnectRPCDispatcher()

    def add_rpc(
        prefix: str,
        application_factory: Callable[..., ASGIApp],
        implementation: object,
        *,
        read_max_bytes: int = DEFAULT_READ_MAX_BYTES,
    ) -> None:
        dispatcher.add_service(
            prefix,
            application_factory(
                implementation,
                interceptors=interceptors,
                codecs=codecs,
                read_max_bytes=read_max_bytes,
            ),
        )

    def add_streaming_rpc(
        prefix: str,
        application_factory: Callable[..., ASGIApp],
        implementation: object,
    ) -> None:
        application = application_factory(
            implementation,
            interceptors=interceptors,
            codecs=codecs,
        )
        dispatcher.add_service(
            prefix,
            StreamDisconnectMiddleware(StreamRevokeWatchMiddleware(application)),
        )

    call_lifecycle = CallsLifecycle(open_session)

    add_rpc(
        "/auth.v1.AuthService",
        AuthServiceASGIApplication,
        AuthHandlers(search_indexer, call_lifecycle),
    )
    add_rpc(
        "/auth.v1.MfaService",
        MfaServiceASGIApplication,
        MfaHandlers(call_lifecycle),
    )
    add_rpc(
        "/notes.v1.NotesService",
        NotesServiceASGIApplication,
        NotesServiceImpl(storage, search_indexer),
    )
    add_rpc("/search.v1.SearchService", SearchServiceASGIApplication, SearchServiceImpl(search))
    add_rpc("/settings.v1.SettingsService", SettingsServiceASGIApplication, SettingsHandlers())
    add_rpc(
        "/bookmarks.v1.BookmarksService",
        BookmarksServiceASGIApplication,
        BookmarksServiceImpl(search_indexer),
    )
    add_rpc("/tags.v1.TagsService", TagsServiceASGIApplication, TagsServiceImpl(search_indexer))
    add_rpc(
        "/chat.v1.ChatService",
        ChatServiceASGIApplication,
        ChatServiceImpl(storage, search_indexer, call_lifecycle),
    )
    add_streaming_rpc(
        "/chat.v1.ChatStreamService",
        ChatStreamServiceASGIApplication,
        ChatStreamHandlers(),
    )
    add_rpc(
        "/permissions.v1.MembersService",
        MembersServiceASGIApplication,
        MembersServiceImpl(search_indexer),
    )
    add_rpc("/presence.v1.PresenceService", PresenceServiceASGIApplication, PresenceHandlers())
    add_rpc(
        "/users.v1.UsersService",
        UsersServiceASGIApplication,
        UsersServiceImpl(storage, search_indexer),
        read_max_bytes=AVATAR_RPC_READ_MAX_BYTES,
    )
    add_rpc(
        "/organizations.v1.OrganizationsService",
        OrganizationsServiceASGIApplication,
        OrganizationsServiceImpl(search_indexer, call_lifecycle),
    )
    add_rpc(
        "/groups.v1.GroupsService",
        GroupsServiceASGIApplication,
        GroupsServiceImpl(search_indexer),
    )
    add_rpc(
        "/people.v1.PeopleService",
        PeopleServiceASGIApplication,
        PeopleServiceImpl(search_indexer),
    )
    add_rpc(
        "/cal.v1.CalendarService",
        CalendarServiceASGIApplication,
        CalendarServiceImpl(search_indexer, call_lifecycle),
        read_max_bytes=CALENDAR_RPC_READ_MAX_BYTES,
    )
    add_rpc(
        "/files.v1.FilesService",
        FilesServiceASGIApplication,
        FilesServiceImpl(storage, search_indexer),
        read_max_bytes=FILES_RPC_READ_MAX_BYTES,
    )
    add_rpc("/audit.v1.AuditService", AuditServiceASGIApplication, AuditServiceImpl())
    add_rpc("/mail.v1.OrgMailService", OrgMailServiceASGIApplication, OrgMailServiceImpl())
    add_rpc(
        "/support.v1.SupportConsentService",
        SupportConsentServiceASGIApplication,
        SupportConsentServiceImpl(),
    )
    add_rpc(
        "/superadmin.v1.SystemMailService",
        SystemMailServiceASGIApplication,
        SystemMailServiceImpl(),
    )
    add_rpc(
        "/superadmin.v1.SystemEncryptionService",
        SystemEncryptionServiceASGIApplication,
        SystemEncryptionServiceImpl(),
    )
    add_rpc(
        "/superadmin.v1.SystemConfigService",
        SystemConfigServiceASGIApplication,
        SystemConfigServiceImpl(),
    )
    add_rpc(
        "/superadmin.v1.SystemOrganizationsService",
        SystemOrganizationsServiceASGIApplication,
        SystemOrganizationsServiceImpl(search_indexer, call_lifecycle),
    )
    add_rpc(
        "/superadmin.v1.SystemUsersService",
        SystemUsersServiceASGIApplication,
        SystemUsersServiceImpl(search_indexer, call_lifecycle),
    )
    add_rpc(
        "/superadmin.v1.SupportService",
        SupportServiceASGIApplication,
        SupportServiceImpl(),
    )
    add_rpc(
        "/superadmin.v1.SystemMfaService",
        SystemMfaServiceASGIApplication,
        SystemMfaHandlers(lambda session: MfaOperations(session, call_lifecycle)),
    )
    add_rpc(
        "/superadmin.v1.PlatformAuditService",
        PlatformAuditServiceASGIApplication,
        PlatformAuditServiceImpl(),
    )
    add_rpc("/comments.v1.CommentsService", CommentsServiceASGIApplication, CommentsHandlers())
    add_streaming_rpc(
        "/notifications.v1.NotificationsService",
        NotificationsServiceASGIApplication,
        NotificationsHandlers(),
    )
    add_rpc(
        "/projects.v1.ProjectsService",
        ProjectsServiceASGIApplication,
        ProjectsServiceImpl(storage, search_indexer),
    )
    add_rpc("/rooms.v1.RoomsService", RoomsServiceASGIApplication, RoomsServiceImpl(search_indexer))
    add_rpc("/calls.v1.CallService", CallServiceASGIApplication, CallHandlers())
    add_rpc(
        "/integrations.v1.IntegrationsService",
        IntegrationsServiceASGIApplication,
        IntegrationsHandlers(),
    )
    add_rpc(
        "/agents.v1.ProvidersService",
        ProvidersServiceASGIApplication,
        ProvidersHandlers(),
    )
    add_rpc("/agents.v1.SessionsService", SessionsServiceASGIApplication, SessionsHandlers())
    add_rpc(
        "/agents.v1.AgentsService",
        AgentsServiceASGIApplication,
        AgentsServiceImpl(storage, search_indexer),
        read_max_bytes=AVATAR_RPC_READ_MAX_BYTES,
    )
    add_rpc("/agents.v1.SkillsService", SkillsServiceASGIApplication, SkillsHandlers())
    add_rpc(
        "/agents.v1.SkillEvaluationsService",
        SkillEvaluationsServiceASGIApplication,
        SkillEvaluationHandlers(),
    )
    add_rpc("/agents.v1.RulesService", RulesServiceASGIApplication, RulesHandlers())
    add_rpc("/agents.v1.MemoriesService", MemoriesServiceASGIApplication, MemoriesHandlers())
    add_rpc(
        "/agents.v1.CronService",
        CronServiceASGIApplication,
        CronServiceImpl(search_indexer),
    )
    add_rpc("/agents.v1.BudgetsService", BudgetsServiceASGIApplication, BudgetsHandlers())
    add_rpc(
        "/agents.v1.RateLimitsService",
        RateLimitsServiceASGIApplication,
        RateLimitsHandlers(),
    )
    add_streaming_rpc(
        "/agents.v1.RuntimeService",
        RuntimeServiceASGIApplication,
        RuntimeServiceImpl(storage, search_indexer),
    )
    add_rpc(
        "/agents.v1.RuntimeSettingsService",
        RuntimeSettingsServiceASGIApplication,
        RuntimeSettingsServiceImpl(),
    )

    http_app = FastAPI()
    setup_request_logging(http_app)
    thumbnails_router, files_router, media_router = create_file_routers(storage)
    calendar_router = create_calendar_router(search_indexer)
    avatars_router = create_avatars_router(storage)
    agent_avatars_router = create_agent_avatars_router(storage)
    http_app.include_router(thumbnails_router)
    http_app.include_router(files_router)
    http_app.include_router(media_router)
    http_app.include_router(calendar_router)
    http_app.include_router(avatars_router)
    http_app.include_router(agent_avatars_router)
    http_app.include_router(realtime_router)
    dispatcher.add_service("/thumbnails", http_app)
    dispatcher.add_service("/files", http_app)
    dispatcher.add_service("/media", http_app)
    dispatcher.add_service("/calendar", http_app)
    dispatcher.add_service("/avatars", http_app)
    dispatcher.add_service("/agents/avatars", http_app)
    dispatcher.add_service("/realtime", http_app)

    return dispatcher
