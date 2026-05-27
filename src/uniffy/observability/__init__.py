from . import config, logger, otel
from .config import LogLevel, ObservabilityConfig
from .crpc import LoggingInterceptor
from .logger import configure_loguru, disable_leveled_namespace


def setup_observability(config: ObservabilityConfig):
    """Configure loguru and, when enabled, OpenTelemetry traces/metrics/logs."""
    configure_loguru(config)

    if config.otel_enabled:
        from .otel import (
            configure_loguru_otel,
            instrument_aiokafka,
            instrument_all_aiohttp_client_sessions,
            instrument_openai,
            instrument_system_metrics,
            setup_otel,
        )

        resource = setup_otel(
            attributes=config.otel_attributes,
            endpoint=config.otel_endpoint,
            protocol=config.otel_protocol,
            timeout=config.otel_timeout,
            sample_rate=config.otel_traces_sample_rate,
            traces_enabled=config.otel_traces_enabled,
        )
        if config.otel_logging_enabled:
            if config.otel_protocol == "grpc":
                from opentelemetry.exporter.otlp.proto.grpc._log_exporter import OTLPLogExporter

                otlp_log_exporter = OTLPLogExporter(
                    timeout=config.otel_timeout, insecure=config.otel_insecure
                )
            else:
                from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter

                otlp_log_exporter = OTLPLogExporter(
                    timeout=config.otel_timeout, insecure=config.otel_insecure
                )

            configure_loguru_otel(
                resource=resource,
                exporter=otlp_log_exporter,
                level=config.otel_log_level.value,
                batch_size=config.otel_batch_size,
                max_queue_size=config.otel_max_queue_size,
                export_interval_ms=config.otel_export_interval_ms,
            )

        if config.otel_system_metrics_enabled:
            instrument_system_metrics()
        if config.otel_instrument_all_aiohttp_client_sessions:
            instrument_all_aiohttp_client_sessions()
        if config.otel_instrument_openai:
            instrument_openai()
        if config.otel_instrument_aiokafka:
            instrument_aiokafka()


__all__ = [
    "logger",
    "config",
    "configure_loguru",
    "disable_leveled_namespace",
    "LogLevel",
    "LoggingInterceptor",
    "ObservabilityConfig",
    "otel",
    "setup_observability",
]
