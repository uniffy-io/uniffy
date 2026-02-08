import asyncio
import os
import signal

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

    asyncio.run(_serve_with_shutdown(app, config))


async def _serve_with_shutdown(app, config: Config) -> None:
    """
    Run hypercorn with a shutdown trigger that immediately stops streaming.

    When SIGINT/SIGTERM arrives:
    1. signal_pubsub_shutdown() fires -- all subscriber generators break
       on their next poll tick (within 1 second).
    2. The shutdown_trigger completes -- hypercorn starts graceful shutdown.

    Without this, hypercorn closes the server socket on SIGINT but active
    streaming handlers keep running for the full graceful_timeout, during
    which the frontend cannot open any new connections.
    """
    from uniffy.core.pubsub import signal_pubsub_shutdown

    shutdown_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    def _on_signal() -> None:
        signal_pubsub_shutdown()
        shutdown_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _on_signal)

    await serve(app, config, shutdown_trigger=shutdown_event.wait)


if __name__ == "__main__":
    main()
