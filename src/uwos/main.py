import uvicorn
from dotenv import load_dotenv
from loguru import logger

from uwos.factory import create_app
from uwos.observability import ObservabilityConfig, setup_observability
from uwos.observability.otel import instrument_fastapi


def main() -> None:
    setup_observability(
        config=ObservabilityConfig(
            app_name="uwos",
            app_version="0.1.0",
            environment="development",
            console_log_level="INFO",
        )
    )
    logger.info("Starting UWOS application...")

    # Load environment variables from .env file
    load_dotenv()

    """Run the UWOS application."""
    app = create_app()
    instrument_fastapi(app=app, exclude_paths=["/health"])
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="debug",
    )


if __name__ == "__main__":
    main()
