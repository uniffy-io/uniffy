import logging
import os
import threading

from loguru import logger

_otel_setup_lock = threading.Lock()
_otel_setup_done = False
_additional_resources = []
_final_resource = None


def add_resource(attributes: dict):
    from opentelemetry.sdk.resources import Resource

    """Adds resource attributes. Must be called before setup_otel."""
    with _otel_setup_lock:
        if _otel_setup_done:
            logging.warning("add_resource called after setup_otel; attributes will be ignored.")
            return
        _additional_resources.append(Resource.create(attributes))


def setup_otel(
    attributes: str | None,
    endpoint: str | None,
    protocol: str,
    timeout: int,
    sample_rate: float = 1.0,
    traces_enabled: bool = True,
):
    """
    Setupups the OpenTelemetry SDK.

    Args:
        attributes: Resource attributes.
        endpoint: OpenTelemetry endpoint.
        protocol: OpenTelemetry protocol.
        timeout: OpenTelemetry timeout.
        sample_rate: OpenTelemetry sample rate.
        traces_enabled: Enable traces.

    """
    from opentelemetry import metrics, trace
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.sdk.trace.sampling import (
        ALWAYS_OFF,
        ALWAYS_ON,
    )

    if not traces_enabled:
        sampler = ALWAYS_OFF
    elif sample_rate >= 1.0:
        sampler = ALWAYS_ON
    elif sample_rate <= 0:
        sampler = ALWAYS_OFF

    if attributes:
        os.environ["OTEL_RESOURCE_ATTRIBUTES"] = attributes
    if endpoint:
        os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = endpoint
    if protocol:
        os.environ["OTEL_EXPORTER_OTLP_PROTOCOL"] = protocol
    global _otel_setup_done, _final_resource
    if _otel_setup_done:
        return _final_resource

    with _otel_setup_lock:
        if _otel_setup_done:
            return _final_resource

        # Create a temporary provider to get the default resource, which includes
        # attributes from environment variables.
        default_resource = TracerProvider().resource

        # Merge with programmatically added resources
        resource = default_resource
        for res in _additional_resources:
            resource = resource.merge(res)

        _final_resource = resource

        if protocol == "grpc":
            from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

            trace_exporter = OTLPSpanExporter(timeout=timeout, insecure=True)
            metric_exporter = OTLPMetricExporter(timeout=timeout, insecure=True)
        else:
            from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

            trace_exporter = OTLPSpanExporter(timeout=timeout)
            metric_exporter = OTLPMetricExporter(timeout=timeout)

        trace_provider = TracerProvider(resource=_final_resource, sampler=sampler)
        trace_provider.add_span_processor(BatchSpanProcessor(trace_exporter))
        trace.set_tracer_provider(trace_provider)

        reader = PeriodicExportingMetricReader(
            metric_exporter,
            export_interval_millis=3000,
            export_timeout_millis=2000,
        )
        meter_provider = MeterProvider(metric_readers=[reader], resource=_final_resource)
        metrics.set_meter_provider(meter_provider)

        _otel_setup_done = True

        return _final_resource


def instrument_sqlalchemy(engine):
    """
    Instruments a SQLAlchemy engine for OpenTelemetry tracing.
    Must be called after setup_otel.
    """
    if not _otel_setup_done:
        logger.warning("SQLAlchemy instrumentation called before setup_otel.")
        return

    try:
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
    except ImportError:
        logger.exception("SQLAlchemy instrumentation not available.")
        return

    SQLAlchemyInstrumentor().instrument(engine=engine)
    logger.info("SQLAlchemy instrumentation enabled.", component="observability")


def instrument_fastapi(app, exclude_paths: list[str] = None):
    """
    Instruments a FastAPI app for OpenTelemetry tracing.
    Must be called after setup_otel.
    """
    if not _otel_setup_done:
        logger.warning("FastAPI instrumentation called before setup_otel.")
        return

    os.environ["OTEL_PYTHON_FASTAPI_EXCLUDE_PATHS"] = ",".join(exclude_paths)

    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    except ImportError:
        logger.exception("FastAPI instrumentation not available.")
        return

    FastAPIInstrumentor().instrument_app(app)
    logger.info("FastAPI instrumentation enabled.", component="observability")


def instrument_aiokafka():
    """
    https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/aiokafka/aiokafka.html

    Instruments a AIOKafka app for OpenTelemetry tracing.
    Must be called after setup_otel.
    """
    if not _otel_setup_done:
        logger.warning("AIOKafka instrumentation called before setup_otel.")
        return

    try:
        from opentelemetry.instrumentation.aiokafka import AIOKafkaInstrumentor
    except ImportError:
        logger.exception("AIOKafka instrumentation not available.")
        return

    AIOKafkaInstrumentor().instrument()
    logger.info("AIOKafka instrumentation enabled.", component="observability")


def instrument_openai():
    """
    https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/openai/openai.html

    Instruments a OpenAI app for OpenTelemetry tracing.
    Must be called after setup_otel.
    """
    if not _otel_setup_done:
        logger.warning("OpenAI instrumentation called before setup_otel.")
        return

    try:
        from opentelemetry.instrumentation.openai_v2 import OpenAIInstrumentor
    except ImportError:
        logger.exception("OpenAI instrumentation not available.")
        return

    OpenAIInstrumentor().instrument()
    logger.info("OpenAI instrumentation enabled.", component="observability")


def instrument_asyncio(coroutines_to_trace: list[str] = None):
    """
    https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/asyncio/asyncio.html

    Instruments a AsyncIO app for OpenTelemetry tracing.
    Must be called after setup_otel.

    Args:
        coroutines_to_trace: List of coroutine names to trace.
        If not provided, all coroutines will be traced.
    """
    if coroutines_to_trace:
        os.environ["OTEL_PYTHON_ASYNCIO_COROUTINE_NAMES_TO_TRACE"] = ",".join(coroutines_to_trace)

    if not _otel_setup_done:
        logger.warning("AsyncIO instrumentation called before setup_otel.")
        return

    try:
        from opentelemetry.instrumentation.asyncio import AsyncioInstrumentor
    except ImportError:
        logger.exception("AsyncIO instrumentation not available.")
        return

    AsyncioInstrumentor().instrument()
    logger.info("AsyncIO instrumentation enabled.", component="observability")


def instrument_system_metrics():
    """
    https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/system_metrics/system_metrics.html

    Instruments a system metrics for OpenTelemetry tracing.
    Must be called after setup_otel.
    """
    if not _otel_setup_done:
        logger.warning("System metrics instrumentation called before setup_otel.")
        return

    try:
        from opentelemetry.instrumentation.system_metrics import SystemMetricsInstrumentor
    except ImportError:
        logger.exception("System metrics instrumentation not available.")
        return

    config = {
        "system.cpu.time": ["idle", "user", "system", "irq"],
        "system.cpu.utilization": ["idle", "user", "system", "irq"],
        "system.memory.usage": ["used", "free", "cached"],
        "system.memory.utilization": ["used", "free", "cached"],
        "system.disk.io": ["read", "write"],
        "system.disk.operations": ["read", "write"],
        "system.disk.time": ["read", "write"],
        "system.network.connections": ["family", "type"],
        "system.thread_count": None,
        "process.context_switches": ["involuntary", "voluntary"],
        "process.cpu.time": ["user", "system"],
        "process.cpu.utilization": None,
        "process.memory.usage": None,
        "process.memory.virtual": None,
        "process.open_file_descriptor.count": None,
        "process.thread.count": None,
        "process.runtime.memory": ["rss", "vms"],
        "process.runtime.cpu.time": ["user", "system"],
        "process.runtime.gc_count": None,
        "process.runtime.thread_count": None,
        "process.runtime.cpu.utilization": None,
        "process.runtime.context_switches": ["involuntary", "voluntary"],
    }

    SystemMetricsInstrumentor(config=config).instrument()


def instrument_all_aiohttp_client_sessions():
    """
    https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/aiohttp_client/aiohttp_client.html

    Instruments a AIOHTTP app for OpenTelemetry tracing.
    Must be called after setup_otel.
    """
    if not _otel_setup_done:
        logger.warning("AIOHTTP instrumentation called before setup_otel.")
        return

    try:
        from opentelemetry.instrumentation.aiohttp_client import AioHttpClientInstrumentor
    except ImportError:
        logger.exception("AIOHTTP instrumentation not available.")
        return

    AioHttpClientInstrumentor().instrument()
