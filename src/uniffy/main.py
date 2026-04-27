from dotenv import load_dotenv

load_dotenv()

from uniffy._metrics_bootstrap import bootstrap_multiproc_metrics

bootstrap_multiproc_metrics("backend")

import os

from granian import Granian
from granian.constants import HTTPModes, Interfaces, Loops
from granian.http import HTTP2Settings
from granian.log import LogLevels


def main() -> None:
    """Run the UNIFFY application."""
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    workers = int(os.getenv("WORKERS", "1"))

    server = Granian(
        target="uniffy.factory:create_app",
        address=host,
        port=port,
        interface=Interfaces.ASGI,
        workers=workers,
        http=HTTPModes.auto,
        http2_settings=HTTP2Settings(
            max_concurrent_streams=128,
            max_headers_size=65536,
            max_frame_size=16384,
        ),
        log_level=LogLevels.warning,
        log_access=False,
        factory=True,
        loop=Loops.auto,
    )

    print(f"Starting UNIFFY on {host}:{port} (workers={workers}, http2=true)")
    server.serve()


if __name__ == "__main__":
    main()
