from .core import (
    add_resource,
    instrument_aiokafka,
    instrument_all_aiohttp_client_sessions,
    instrument_asyncio,
    instrument_fastapi,
    instrument_openai,
    instrument_sqlalchemy,
    instrument_system_metrics,
    setup_otel,
)
from .logger import configure_loguru_otel

__all__ = [
    "add_resource",
    "setup_otel",
    "configure_loguru_otel",
    "instrument_sqlalchemy",
    "instrument_asyncio",
    "instrument_fastapi",
    "instrument_openai",
    "instrument_aiokafka",
    "instrument_all_aiohttp_client_sessions",
    "instrument_system_metrics",
]
