from enum import StrEnum
from typing import Literal

from pydantic import BaseModel


class LogLevel(StrEnum):
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class ObservabilityConfig(BaseModel):
    app_name: str
    app_version: str
    environment: str

    # Console logging
    console_log_level: LogLevel = LogLevel.INFO
    console_log_type: Literal["json", "console"] = "console"

    # SQLAlchemy logging level
    sqlalchemy_level: LogLevel = LogLevel.INFO

    # OpenTelemetry
    otel_enabled: bool = False
    otel_traces_enabled: bool = True
    otel_attributes: str | None = None
    otel_endpoint: str | None = None
    otel_protocol: str = "http/protobuf"
    otel_insecure: bool = True
    otel_logging_enabled: bool = True
    otel_timeout: int = 10
    otel_log_level: LogLevel = LogLevel.INFO
    otel_traces_sample_rate: float = 1.0
    otel_batch_size: int = 100
    otel_max_queue_size: int = 10000
    otel_export_interval_ms: int = 1000

    # OpenTelemetry instrumentation
    otel_system_metrics_enabled: bool = False
    otel_instrument_all_aiohttp_client_sessions: bool = False
    otel_instrument_openai: bool = False

    otel_instrument_sqlalchemy: bool = False
    otel_instrument_fastapi: bool = False
    otel_instrument_aiokafka: bool = False
    otel_instrument_asyncio: bool = False
