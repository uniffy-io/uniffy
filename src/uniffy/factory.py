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
from loguru import logger
from starlette.types import ASGIApp, Receive, Scope, Send

from uniffy.core.queue import close_queue, init_queue
from uniffy.core.search import close_meilisearch, init_meilisearch
from uniffy.core.storage.s3_client import close_s3, init_s3
from uniffy.db import close_db, init_db, seed_initial_data
from uniffy.domains.attachments.service import AttachmentsServiceImpl
from uniffy.domains.auth.service import AuthServiceImpl
from uniffy.domains.bookmarks.service import BookmarksServiceImpl
from uniffy.domains.calendar.service import CalendarServiceImpl
from uniffy.domains.files.http_routes import files_router, thumbnails_router
from uniffy.domains.files.service import FilesServiceImpl
from uniffy.domains.groups.service import GroupsServiceImpl
from uniffy.domains.notes.service import NotesServiceImpl
from uniffy.domains.organizations.service import OrganizationsServiceImpl
from uniffy.domains.permissions.service import PermissionsServiceImpl
from uniffy.domains.search.service import SearchServiceImpl
from uniffy.domains.settings.service import SettingsServiceImpl
from uniffy.domains.users.service import UsersServiceImpl
from uniffy.gen.attachments.v1.attachments_connect import AttachmentsServiceASGIApplication
from uniffy.gen.auth.v1.auth_connect import AuthServiceASGIApplication
from uniffy.gen.bookmarks.v1.bookmarks_connect import BookmarksServiceASGIApplication
from uniffy.gen.cal.v1.calendar_connect import CalendarServiceASGIApplication
from uniffy.gen.files.v1.files_connect import FilesServiceASGIApplication
from uniffy.gen.groups.v1.groups_connect import GroupsServiceASGIApplication
from uniffy.gen.notes.v1.notes_connect import NotesServiceASGIApplication
from uniffy.gen.organizations.v1.organizations_connect import OrganizationsServiceASGIApplication
from uniffy.gen.permissions.v1.permissions_connect import PermissionsServiceASGIApplication
from uniffy.gen.search.v1.search_connect import SearchServiceASGIApplication
from uniffy.gen.settings.v1.settings_connect import SettingsServiceASGIApplication
from uniffy.gen.users.v1.users_connect import UsersServiceASGIApplication
from uniffy.observability import ObservabilityConfig, setup_observability
from uniffy.observability.crpc import LoggingInterceptor, http_version_var
from uniffy.observability.fastapi.logger import setup_request_logging
from uniffy.observability.otel import instrument_fastapi


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

        # Strip the mount prefix from the path
        # FastAPI's mount() sets root_path but doesn't strip the prefix from path
        if root_path and path.startswith(root_path):
            path = path[len(root_path):] or "/"

        # Find matching service by prefix
        for prefix, service_app in self.services:
            if path.startswith(prefix):
                service_scope = dict(scope)
                service_scope["path"] = path
                await service_app(service_scope, receive, send)
                return

        # Try fallback app
        if self.fallback is not None:
            fallback_scope = dict(scope)
            fallback_scope["path"] = path
            await self.fallback(fallback_scope, receive, send)
            return

        # No match found
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
    """
    Manage application lifespan events.

    Handles startup (database, Meilisearch initialization) and shutdown (cleanup).
    """
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

    # Initialize job queue (non-blocking - app can run without it)
    try:
        await init_queue()
        logger.info("Job queue initialized successfully")
    except Exception as e:
        logger.warning(f"Job queue not available: {e}")

    try:
        await seed_initial_data()
        logger.info("Initial data seeded successfully")
    except Exception as e:
        logger.exception(f"Failed to seed initial data: {e}")
        raise

    yield

    # Shutdown
    logger.info("Shutting down UNIFFY application...")
    await close_queue()
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

    @app.middleware("http")
    async def log_requests(request, call_next):
        http_version_var.set(request.scope.get("http_version", "unknown"))
        try:
            response = await call_next(request)
            return response
        except Exception as e:
            logger.exception(f"Unhandled exception in request {e}")
            raise

    cors_origins = _get_cors_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )

    api_dispatcher = _create_api_dispatcher()
    app.mount("/api", api_dispatcher)

    @app.get("/healthz")
    async def health_check():
        return {"status": "ok", "service": "uniffy"}

    instrument_fastapi(app=app, exclude_paths=["/healthz"])

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
        "/permissions.v1.PermissionsService",
        PermissionsServiceASGIApplication(
            PermissionsServiceImpl(), interceptors=[logging_interceptor]
        ),
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

    # HTTP routes (thumbnails and files)
    http_app = FastAPI()
    setup_request_logging(http_app)
    http_app.include_router(thumbnails_router)
    http_app.include_router(files_router)
    dispatcher.add_service("/thumbnails", http_app)
    dispatcher.add_service("/files", http_app)

    return dispatcher
