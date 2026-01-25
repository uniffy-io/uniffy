import os

import uvicorn
from dotenv import load_dotenv

load_dotenv()


def main() -> None:
    """Run the UWOS application."""
    # Server configuration from environment
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    workers = int(os.getenv("WORKERS", "1"))
    log_level = os.getenv("LOG_LEVEL", "info").lower()
    reload_enabled = os.getenv("RELOAD", "false").lower() == "true"

    print(f"Starting UWOS on {host}:{port} (workers={workers}, reload={reload_enabled})")

    # Use import string when reload or multiple workers are enabled
    # This allows uvicorn to properly spawn/reload processes
    use_import_string = reload_enabled or workers > 1

    if use_import_string:
        uvicorn.run(
            "uwos.factory:create_app",
            factory=True,
            host=host,
            port=port,
            log_level=log_level,
            workers=workers if workers > 1 else 1,
            reload=reload_enabled,
            access_log=False,  # We have our own ConnectRPC access logging
        )
    else:
        from uwos.factory import create_app

        app = create_app()
        uvicorn.run(
            app,
            host=host,
            port=port,
            log_level=log_level,
            access_log=False,  # We have our own ConnectRPC access logging
        )


if __name__ == "__main__":
    main()
