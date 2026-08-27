"""Bootstrap observability and expose the ARQ worker entry points."""

import os

from dotenv import load_dotenv

load_dotenv()

from uniffy.observability import ObservabilityConfig, setup_observability

_environment = os.getenv("ENVIRONMENT", "development")
_log_level = os.getenv("LOG_LEVEL", "info").upper()
_log_format = os.getenv("LOG_FORMAT", "console").lower()

setup_observability(
    config=ObservabilityConfig(
        app_name="uniffy-worker",
        app_version="0.1.0",
        environment=_environment,
        console_log_level=_log_level,
        console_log_type=_log_format,
    )
)

from uniffy.workers.fleets import CoreWorkerSettings, EgressWorkerSettings

__all__ = ["CoreWorkerSettings", "EgressWorkerSettings"]
