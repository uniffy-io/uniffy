import asyncio
import os

from hypercorn.asyncio import serve
from hypercorn.config import Config


def main() -> None:
    """Run the UNIFFY application."""
    from uniffy.factory import create_app

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    workers = int(os.getenv("WORKERS", "1"))
    log_level = os.getenv("LOG_LEVEL", "info").lower()

    config = Config()
    config.bind = [f"{host}:{port}"]
    config.workers = workers
    config.loglevel = log_level.upper()

    # HTTP/2 h2c support (for Envoy/K8s backends)
    config.h2_max_concurrent_streams = 128
    config.h2_max_header_list_size = 65536
    config.h2_max_inbound_frame_size = 16384

    # Logging - we have our own ConnectRPC access logging
    config.accesslog = None
    config.errorlog = "-"

    # Graceful shutdown
    config.graceful_timeout = 10.0

    app = create_app()

    # Check if h2 is available for HTTP/2 support
    try:
        import h2  # noqa: F401

        h2_available = True
    except ImportError:
        h2_available = False

    print(f"Starting UNIFFY on {host}:{port} (workers={workers}, http2={h2_available})")
    if not h2_available:
        print("WARNING: h2 package not installed - HTTP/2 disabled, using HTTP/1.1")

    asyncio.run(serve(app, config))


if __name__ == "__main__":
    main()
