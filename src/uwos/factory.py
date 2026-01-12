import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from uwos.db import close_db, init_db
from uwos.db.seed import seed_initial_data
from uwos.gen.auth.v1.auth_connect import AuthServiceASGIApplication
from uwos.gen.notes.v1.notes_connect import NotesServiceASGIApplication
from uwos.gen.search.v1.search_connect import SearchServiceASGIApplication
from uwos.observability.crpc import LoggingInterceptor
from uwos.services.auth_service import AuthServiceImpl
from uwos.services.notes_service import NotesServiceImpl
from uwos.services.search_service import SearchServiceImpl

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage application lifespan events.

    Handles startup (database initialization) and shutdown (cleanup).
    """
    # Startup
    logger.info("Starting UWOS application...")
    try:
        await init_db()
        await seed_initial_data()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.exception(f"Failed to initialize database: {e}")
        raise

    yield

    # Shutdown
    logger.info("Shutting down UWOS application...")
    await close_db()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
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
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # In production, replace with specific origins
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )

    # Mount ConnectRPC services
    _mount_connect_services(app)

    # Mount static files for UI if available
    _mount_ui(app)

    # Health check endpoint
    @app.get("/api/health")
    async def health_check():
        return {"status": "ok", "service": "uwos"}

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


def _mount_ui(app: FastAPI) -> None:
    """Mount static files for UI if available."""
    # Get the static files directory path
    ui_build_dir = Path(__file__).parent.parent / "ui" / "dist"

    if not ui_build_dir.exists():
        logger.warning(f"UI build directory not found at {ui_build_dir}")
        return

    logger.info(f"Mounting UI static files from {ui_build_dir}")

    # Mount static assets (JS, CSS, images, etc.)
    app.mount(
        "/assets",
        StaticFiles(directory=ui_build_dir / "assets"),
        name="static-assets",
    )

    # Serve index.html for root and all non-API routes (SPA routing)
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Don't intercept API routes
        if full_path.startswith("api/"):
            return {"error": "Not found"}

        # Serve index.html for all other routes
        index_file = ui_build_dir / "index.html"
        if index_file.exists():
            return FileResponse(index_file)

        return {"error": "UI not built"}
