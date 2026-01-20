import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from uwos.core.search import close_meilisearch, init_meilisearch
from uwos.db import close_db, init_db, seed_initial_data
from uwos.domains.auth.service import AuthServiceImpl
from uwos.domains.bookmarks.service import BookmarksServiceImpl
from uwos.domains.notes.service import NotesServiceImpl
from uwos.domains.search.service import SearchServiceImpl
from uwos.domains.settings.service import SettingsServiceImpl
from uwos.gen.auth.v1.auth_connect import AuthServiceASGIApplication
from uwos.gen.bookmarks.v1.bookmarks_connect import BookmarksServiceASGIApplication
from uwos.gen.notes.v1.notes_connect import NotesServiceASGIApplication
from uwos.gen.search.v1.search_connect import SearchServiceASGIApplication
from uwos.gen.settings.v1.settings_connect import SettingsServiceASGIApplication
from uwos.observability import ObservabilityConfig, setup_observability
from uwos.observability.crpc import LoggingInterceptor
from uwos.observability.otel import instrument_fastapi


def _setup_observability() -> None:
    """Setup observability for the current process."""
    environment = os.getenv("ENVIRONMENT", "development")
    log_level = os.getenv("LOG_LEVEL", "info").upper()

    setup_observability(
        config=ObservabilityConfig(
            app_name="uwos",
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
    logger.info("Starting UWOS application...")

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
        await seed_initial_data()
        logger.info("Initial data seeded successfully")
    except Exception as e:
        logger.exception(f"Failed to seed initial data: {e}")
        raise

    yield

    # Shutdown
    logger.info("Shutting down UWOS application...")
    await close_meilisearch()
    await close_db()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    # Setup observability for this process (important for multi-worker mode)
    _setup_observability()

    app = FastAPI(
        title="UWOS - Unified Work Operating System",
        description="The Operating System for Work",
        version="0.1.0",
        lifespan=lifespan,
    )

    # Add middleware to log ALL requests
    @app.middleware("http")
    async def log_requests(request, call_next):
        try:
            response = await call_next(request)
            return response
        except Exception as e:
            logger.exception(f"Unhandled exception in request {e}")
            raise

    # Add CORS middleware
    cors_origins = _get_cors_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )

    # Mount ConnectRPC services
    _mount_connect_services(app)

    @app.get("/api/health")
    async def health_check():
        return {"status": "ok", "service": "uwos"}

    # Instrument FastAPI for observability
    instrument_fastapi(app=app, exclude_paths=["/health", "/api/health"])

    logger.info(f"CORS allowed origins: {cors_origins}")
    return app


def _mount_connect_services(app: FastAPI) -> None:
    """Mount ConnectRPC services."""
    logger.info("Mounting ConnectRPC services")

    # Create logging interceptor for all services
    logging_interceptor = LoggingInterceptor()

    # Create and mount the auth service with logging interceptor
    auth_service = AuthServiceImpl()
    auth_app = AuthServiceASGIApplication(
        auth_service,
        interceptors=[logging_interceptor],
    )
    app.mount("/auth.v1.AuthService", auth_app)
    logger.info("Mounted AuthService at /auth.v1.AuthService")

    # Create and mount the notes service
    notes_service = NotesServiceImpl()
    notes_app = NotesServiceASGIApplication(
        notes_service,
        interceptors=[logging_interceptor],
    )
    app.mount("/notes.v1.NotesService", notes_app)
    logger.info("Mounted NotesService at /notes.v1.NotesService")

    # Create and mount the search service
    search_service = SearchServiceImpl()
    search_app = SearchServiceASGIApplication(
        search_service,
        interceptors=[logging_interceptor],
    )
    app.mount("/search.v1.SearchService", search_app)
    logger.info("Mounted SearchService at /search.v1.SearchService")

    # Create and mount the settings service
    settings_service = SettingsServiceImpl()
    settings_app = SettingsServiceASGIApplication(
        settings_service,
        interceptors=[logging_interceptor],
    )
    app.mount("/settings.v1.SettingsService", settings_app)
    logger.info("Mounted SettingsService at /settings.v1.SettingsService")

    # Create and mount the bookmarks service
    bookmarks_service = BookmarksServiceImpl()
    bookmarks_app = BookmarksServiceASGIApplication(
        bookmarks_service,
        interceptors=[logging_interceptor],
    )
    app.mount("/bookmarks.v1.BookmarksService", bookmarks_app)
    logger.info("Mounted BookmarksService at /bookmarks.v1.BookmarksService")
