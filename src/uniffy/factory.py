"""
Application factory for UNIFFY.

Creates and configures the FastAPI application with ConnectRPC services.
"""

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
from uniffy_proto.agents.v1.pricing_connect import PricingServiceASGIApplication
from uniffy_proto.agents.v1.prompts_connect import PromptsServiceASGIApplication
from uniffy_proto.agents.v1.providers_connect import ProvidersServiceASGIApplication
from uniffy_proto.agents.v1.rate_limits_connect import RateLimitsServiceASGIApplication
from uniffy_proto.agents.v1.runtime_connect import RuntimeServiceASGIApplication
from uniffy_proto.agents.v1.sessions_connect import SessionsServiceASGIApplication
from uniffy_proto.agents.v1.skills_connect import SkillsServiceASGIApplication
from uniffy_proto.attachments.v1.attachments_connect import AttachmentsServiceASGIApplication
from uniffy_proto.auth.v1.auth_connect import AuthServiceASGIApplication
from uniffy_proto.bookmarks.v1.bookmarks_connect import BookmarksServiceASGIApplication
from uniffy_proto.cal.v1.calendar_connect import CalendarServiceASGIApplication
from uniffy_proto.chat.v1.chat_connect import ChatServiceASGIApplication
from uniffy_proto.chat.v1.chat_stream_connect import ChatStreamServiceASGIApplication
from uniffy_proto.comments.v1.comments_connect import CommentsServiceASGIApplication
from uniffy_proto.files.v1.files_connect import FilesServiceASGIApplication
from uniffy_proto.groups.v1.groups_connect import GroupsServiceASGIApplication
from uniffy_proto.notes.v1.notes_connect import NotesServiceASGIApplication
from uniffy_proto.notifications.v1.notifications_connect import NotificationsServiceASGIApplication
from uniffy_proto.organizations.v1.organizations_connect import OrganizationsServiceASGIApplication
from uniffy_proto.permissions.v1.permissions_connect import MembersServiceASGIApplication
from uniffy_proto.presence.v1.presence_connect import PresenceServiceASGIApplication
from uniffy_proto.projects.v1.projects_connect import ProjectsServiceASGIApplication
from uniffy_proto.rooms.v1.rooms_connect import RoomsServiceASGIApplication
from uniffy_proto.search.v1.search_connect import SearchServiceASGIApplication
from uniffy_proto.settings.v1.settings_connect import SettingsServiceASGIApplication
from uniffy_proto.tags.v1.tags_connect import TagsServiceASGIApplication
from uniffy_proto.users.v1.users_connect import UsersServiceASGIApplication

from uniffy.core.llm_providers import (
    close_provider_invalidation_subscriber,
    init_provider_invalidation_subscriber,
)
from uniffy.core.realtime import realtime_router
from uniffy.core.realtime.router import router as realtime_pubsub_router
from uniffy.core.search import close_meilisearch, init_meilisearch
from uniffy.core.storage.s3_client import close_s3, init_s3
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
from uniffy.db import close_db, init_db, seed_initial_data
from uniffy.domains.agents.agents.http_routes import agent_avatars_router
from uniffy.domains.agents.agents.service import AgentsServiceImpl
from uniffy.domains.agents.budgets.service import BudgetsServiceImpl
from uniffy.domains.agents.cron.service import CronServiceImpl
from uniffy.domains.agents.memories.service import MemoriesServiceImpl
from uniffy.domains.agents.pricing_service.service import PricingServiceImpl
from uniffy.domains.agents.prompts.service import PromptsServiceImpl
from uniffy.domains.agents.providers.service import ProvidersServiceImpl
from uniffy.domains.agents.rate_limits.service import RateLimitsServiceImpl
from uniffy.domains.agents.runtime.service import RuntimeServiceImpl
from uniffy.domains.agents.sessions.service import SessionsServiceImpl
from uniffy.domains.agents.skills.service import SkillsServiceImpl
from uniffy.domains.attachments.service import AttachmentsServiceImpl
from uniffy.domains.auth.service import AuthServiceImpl
from uniffy.domains.bookmarks.service import BookmarksServiceImpl
from uniffy.domains.calendar.service import CalendarServiceImpl
from uniffy.domains.chat.service import ChatServiceImpl
from uniffy.domains.chat.streaming.service import ChatStreamServiceImpl
from uniffy.domains.comments.service import CommentsServiceImpl
from uniffy.domains.files.http_routes import files_router, thumbnails_router
from uniffy.domains.files.service import FilesServiceImpl
from uniffy.domains.groups.service import GroupsServiceImpl
from uniffy.domains.notes.service import NotesServiceImpl
from uniffy.domains.notifications.middleware import StreamDisconnectMiddleware
from uniffy.domains.notifications.service import NotificationsServiceImpl
from uniffy.domains.organizations.service import OrganizationsServiceImpl
from uniffy.domains.permissions.service import MembersServiceImpl
from uniffy.domains.presence.service import PresenceServiceImpl
from uniffy.domains.projects.service import ProjectsServiceImpl
from uniffy.domains.rooms.service import RoomsServiceImpl
from uniffy.domains.search.service import SearchServiceImpl
from uniffy.domains.settings.service import SettingsServiceImpl
from uniffy.domains.tags.service import TagsServiceImpl
from uniffy.domains.users.http_routes import avatars_router
from uniffy.domains.users.service import UsersServiceImpl
from uniffy.observability import ObservabilityConfig, setup_observability
from uniffy.observability.crpc import LoggingInterceptor, http_version_var
from uniffy.observability.fastapi.logger import setup_request_logging
from uniffy.observability.metrics import get_metrics
from uniffy.observability.otel import instrument_fastapi


class HttpVersionMiddleware:
    """Set the HTTP version context variable. Raw ASGI (not
    BaseHTTPMiddleware) - BaseHTTPMiddleware's anyio channel wrapping
    breaks long-lived server streaming.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            http_version_var.set(scope.get("http_version", "unknown"))
        await self.app(scope, receive, send)


class SecurityHeadersMiddleware:
    """Add standard security response headers. Raw ASGI so it composes
    with the long-lived streaming responses used by chat / notifications
    / agents.
    """

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
    """
    ASGI dispatcher for ConnectRPC services.

    Routes requests to the appropriate ConnectRPC service based on path prefix.
    Handles path stripping when mounted under a prefix (e.g., /api).
    """

    def __init__(self) -> None:
        self.services: list[tuple[str, ASGIApp]] = []
        self.fallback: ASGIApp | None = None

    def add_service(self, prefix: str, app: ASGIApp) -> None:
        """Add a service that handles paths starting with prefix."""
        self.services.append((prefix, app))

    def set_fallback(self, app: ASGIApp) -> None:
        """Set a fallback app for non-ConnectRPC routes."""
        self.fallback = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            return

        path = scope.get("path", "")
        root_path = scope.get("root_path", "")

        # FastAPI's mount() sets root_path without stripping the
        # prefix from path; do it ourselves before service dispatch.
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
    """Setup observability for the current process."""
    environment = os.getenv("ENVIRONMENT", "development")
    log_level = os.getenv("LOG_LEVEL", "info").upper()

    setup_observability(
        config=ObservabilityConfig(
            app_name="uniffy",
            app_version="0.1.0",
            environment=environment,
            console_log_level=log_level,
        )
    )


def _get_cors_origins() -> list[str]:
    """Get CORS origins from environment variable."""
    origins = os.getenv("CORS_ORIGINS", "*")
    if origins == "*":
        return ["*"]
    return [origin.strip() for origin in origins.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan events (startup + shutdown)."""
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

    # Initialize core + egress queue pools (non-blocking - app can run without them)
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

    # Initialize Pub/Sub (non-blocking - app can run without it)
    try:
        await init_pubsub()
        logger.info("Pub/Sub initialized successfully")
    except Exception as e:
        logger.warning(f"Pub/Sub not available: {e}")

    # Fail-fast ops client for cache / presence / rate-limit /
    # mention-state. Non-blocking: a Valkey outage at boot makes every
    # cache read a miss; the app still serves.
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

    # Provider-key invalidation: drops the in-process LRU on a peer's
    # provider_keys:invalidate:{key_id} publish.
    try:
        await init_provider_invalidation_subscriber()
    except Exception as e:
        logger.warning(f"Provider invalidation subscriber not available: {e}")

    try:
        from uniffy.core.realtime import ydoc_manager as _rt_manager  # noqa: F401

        await realtime_pubsub_router.start()
        logger.info("Realtime router started successfully")
    except Exception as e:
        logger.warning(f"Realtime router not available: {e}")

    try:
        await seed_initial_data()
        logger.info("Initial data seeded successfully")
    except Exception as e:
        logger.exception(f"Failed to seed initial data: {e}")
        raise

    # Load VAPID config from DB/env (non-blocking - push works without it)
    try:
        from uniffy.core.config.push import load_vapid_config

        await load_vapid_config()
    except Exception as e:
        logger.warning(f"VAPID config not available: {e}")

    yield

    # Shutdown
    logger.info("Shutting down UNIFFY application...")
    await realtime_pubsub_router.stop()
    signal_pubsub_shutdown()
    await close_provider_invalidation_subscriber()
    await close_streams_client()
    await close_ops_client()
    await close_pubsub()
    await close_queue("core")
    await close_queue("egress")
    await close_s3()
    await close_meilisearch()
    await close_db()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
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

    api_dispatcher = _create_api_dispatcher()
    app.mount("/api", api_dispatcher)

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
    """Create the API dispatcher with all ConnectRPC services and HTTP routes."""
    logging_interceptor = LoggingInterceptor()
    dispatcher = ConnectRPCDispatcher()

    # ConnectRPC services
    dispatcher.add_service(
        "/auth.v1.AuthService",
        AuthServiceASGIApplication(AuthServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/notes.v1.NotesService",
        NotesServiceASGIApplication(NotesServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/search.v1.SearchService",
        SearchServiceASGIApplication(SearchServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/settings.v1.SettingsService",
        SettingsServiceASGIApplication(SettingsServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/bookmarks.v1.BookmarksService",
        BookmarksServiceASGIApplication(BookmarksServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/tags.v1.TagsService",
        TagsServiceASGIApplication(TagsServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/chat.v1.ChatService",
        ChatServiceASGIApplication(ChatServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/chat.v1.ChatStreamService",
        StreamDisconnectMiddleware(
            ChatStreamServiceASGIApplication(
                ChatStreamServiceImpl(), interceptors=[logging_interceptor]
            )
        ),
    )
    dispatcher.add_service(
        "/permissions.v1.MembersService",
        MembersServiceASGIApplication(MembersServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/presence.v1.PresenceService",
        PresenceServiceASGIApplication(PresenceServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/users.v1.UsersService",
        UsersServiceASGIApplication(UsersServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/organizations.v1.OrganizationsService",
        OrganizationsServiceASGIApplication(
            OrganizationsServiceImpl(), interceptors=[logging_interceptor]
        ),
    )
    dispatcher.add_service(
        "/groups.v1.GroupsService",
        GroupsServiceASGIApplication(GroupsServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/cal.v1.CalendarService",
        CalendarServiceASGIApplication(CalendarServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/files.v1.FilesService",
        FilesServiceASGIApplication(FilesServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/attachments.v1.AttachmentsService",
        AttachmentsServiceASGIApplication(
            AttachmentsServiceImpl(), interceptors=[logging_interceptor]
        ),
    )
    dispatcher.add_service(
        "/comments.v1.CommentsService",
        CommentsServiceASGIApplication(CommentsServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/notifications.v1.NotificationsService",
        StreamDisconnectMiddleware(
            NotificationsServiceASGIApplication(
                NotificationsServiceImpl(), interceptors=[logging_interceptor]
            )
        ),
    )
    dispatcher.add_service(
        "/projects.v1.ProjectsService",
        ProjectsServiceASGIApplication(ProjectsServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/rooms.v1.RoomsService",
        RoomsServiceASGIApplication(RoomsServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/agents.v1.ProvidersService",
        ProvidersServiceASGIApplication(ProvidersServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/agents.v1.SessionsService",
        SessionsServiceASGIApplication(SessionsServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/agents.v1.AgentsService",
        AgentsServiceASGIApplication(AgentsServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/agents.v1.SkillsService",
        SkillsServiceASGIApplication(SkillsServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/agents.v1.PromptsService",
        PromptsServiceASGIApplication(PromptsServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/agents.v1.MemoriesService",
        MemoriesServiceASGIApplication(MemoriesServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/agents.v1.CronService",
        CronServiceASGIApplication(CronServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/agents.v1.BudgetsService",
        BudgetsServiceASGIApplication(BudgetsServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/agents.v1.PricingService",
        PricingServiceASGIApplication(PricingServiceImpl(), interceptors=[logging_interceptor]),
    )
    dispatcher.add_service(
        "/agents.v1.RateLimitsService",
        RateLimitsServiceASGIApplication(
            RateLimitsServiceImpl(), interceptors=[logging_interceptor]
        ),
    )
    dispatcher.add_service(
        "/agents.v1.RuntimeService",
        StreamDisconnectMiddleware(
            RuntimeServiceASGIApplication(RuntimeServiceImpl(), interceptors=[logging_interceptor])
        ),
    )

    # HTTP routes (thumbnails, files, avatars) + realtime WebSocket
    http_app = FastAPI()
    setup_request_logging(http_app)
    http_app.include_router(thumbnails_router)
    http_app.include_router(files_router)
    http_app.include_router(avatars_router)
    http_app.include_router(agent_avatars_router)
    http_app.include_router(realtime_router)
    dispatcher.add_service("/thumbnails", http_app)
    dispatcher.add_service("/files", http_app)
    dispatcher.add_service("/avatars", http_app)
    dispatcher.add_service("/agents/avatars", http_app)
    dispatcher.add_service("/realtime", http_app)

    return dispatcher
