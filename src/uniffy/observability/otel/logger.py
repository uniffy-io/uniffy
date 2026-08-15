import atexit
import queue
import signal
import sys
import threading
import time
import traceback
from time import time_ns
from typing import Any

from loguru import logger

MAX_QUEUE_SIZE = 10000


class OTLPHandler:
    _instances = []
    _shutdown_lock = threading.Lock()
    _is_shutting_down = False

    def __init__(
        self,
        resource,
        exporter,
        max_queue_size: int = MAX_QUEUE_SIZE,
        batch_size: int = 100,
        export_interval_ms: int = 1000,
    ):
        from opentelemetry.sdk._logs import LoggerProvider as OTLPLoggerProvider
        from opentelemetry.sdk._logs.export import BatchLogRecordProcessor

        self._resource = resource
        self._queue = queue.Queue(maxsize=max_queue_size)
        self._shutdown_event = threading.Event()

        # Initialize logger provider with resource
        self._logger_provider = OTLPLoggerProvider(resource=self._resource)
        self._logger_provider.add_log_record_processor(
            BatchLogRecordProcessor(
                exporter,
                max_export_batch_size=batch_size,
                schedule_delay_millis=export_interval_ms,
                export_timeout_millis=5000,
            )
        )
        service_name = self._resource.attributes.get("service.name", "unknown_service")
        self._logger = self._logger_provider.get_logger(str(service_name))

        self._worker = threading.Thread(target=self._process_queue, name="loguru_otlp_worker")
        self._worker.daemon = True
        self._worker.start()

        with self._shutdown_lock:
            self.__class__._instances.append(self)

        # Signal + atexit handlers are global; install only once.
        if len(self._instances) == 1:
            atexit.register(self._shutdown_all_handlers)
            signal.signal(signal.SIGINT, self._signal_handler)
            signal.signal(signal.SIGTERM, self._signal_handler)

    def _get_trace_context(self) -> tuple:
        from opentelemetry import trace

        span_context = trace.get_current_span().get_span_context()
        return (
            span_context.trace_id if span_context.is_valid else 0,
            span_context.span_id if span_context.is_valid else 0,
            span_context.trace_flags if span_context.is_valid else 0,
        )

    def _get_severity(self, level_no: int) -> tuple:
        """Map a loguru level number to OTEL severity number + text."""
        from opentelemetry._logs import SeverityNumber

        SEVERITY_MAPPING = {
            10: SeverityNumber.DEBUG,
            20: SeverityNumber.INFO,
            30: SeverityNumber.WARN,
            40: SeverityNumber.ERROR,
            50: SeverityNumber.FATAL,
        }
        base_level = (level_no // 10) * 10
        return (
            SEVERITY_MAPPING.get(base_level, SeverityNumber.UNSPECIFIED),
            "CRITICAL"
            if level_no >= 50
            else "ERROR"
            if level_no >= 40
            else "WARNING"
            if level_no >= 30
            else "INFO"
            if level_no >= 20
            else "DEBUG",
        )

    def _extract_attributes(self, record: dict[str, Any]) -> dict[str, Any]:
        attributes = {
            "code.filepath": record["file"].path,
            "code.function": record["function"],
            "code.lineno": record["line"],
            "filename": record["file"].name,
        }

        if extra := record.get("extra"):
            attributes.update(extra)

        if "exception" in record and record["exception"]:  # noqa: PLR2004
            exc_type, exc_value, exc_tb = record["exception"]
            if exc_type:
                attributes.update({
                    "exception.type": exc_type.__name__,
                    "exception.message": str(exc_value) if exc_value else "No message",
                    "exception.stacktrace": "".join(
                        traceback.format_exception(exc_type, exc_value, exc_tb)
                    )
                    if exc_tb
                    else "No stacktrace",
                })

        return attributes

    def _create_log_record(self, record: dict[str, Any]):
        from opentelemetry._logs import SeverityNumber
        from opentelemetry.sdk._logs import LogRecord

        severity_number, severity_text = self._get_severity(record["level"].no)
        trace_id, span_id, trace_flags = self._get_trace_context()

        if "exception" in record and record["exception"]:  # noqa: PLR2004
            severity_number = SeverityNumber.FATAL
            severity_text = "CRITICAL"

        return LogRecord(
            timestamp=int(record["time"].timestamp() * 1e9),
            observed_timestamp=time_ns(),
            trace_id=trace_id,
            span_id=span_id,
            trace_flags=trace_flags,
            severity_text=severity_text,
            severity_number=severity_number,
            body=record["message"],
            resource=self._logger.resource,
            attributes=self._extract_attributes(record),
        )

    @classmethod
    def _shutdown_all_handlers(cls):
        with cls._shutdown_lock:
            if cls._is_shutting_down:
                return
            cls._is_shutting_down = True

            handlers = cls._instances.copy()

        for handler in handlers:
            try:
                handler.shutdown()
            except Exception as e:
                print(f"Error shutting down handler: {e}", file=sys.stderr)

        with cls._shutdown_lock:
            cls._instances.clear()

    @classmethod
    def _signal_handler(cls, signum, frame):
        print("\nShutting down logger...", file=sys.stderr)
        cls._shutdown_all_handlers()
        sys.exit(0)

    def _process_queue(self) -> None:
        while not self._shutdown_event.is_set() or not self._queue.empty():
            try:
                try:
                    record = self._queue.get(timeout=0.1)
                except queue.Empty:
                    continue

                if record is None:
                    self._queue.task_done()
                    continue

                log_record = self._create_log_record(record)
                self._logger.emit(log_record)
                self._queue.task_done()

            except Exception as e:
                print(f"Error processing log record: {e}", file=sys.stderr)

    def sink(self, message) -> None:
        if self._shutdown_event.is_set():
            return

        try:
            self._queue.put_nowait(message.record)
        except queue.Full:
            print("Warning: Log queue full, dropping message", file=sys.stderr)

    def shutdown(self) -> None:
        if self._shutdown_event.is_set():
            return

        try:
            self._shutdown_event.set()
            try:
                if not self._queue.empty():
                    timeout = 5.0
                    start_time = time.time()

                    while not self._queue.empty() and (time.time() - start_time) < timeout:
                        time.sleep(0.1)

                    if not self._queue.empty():
                        print("Warning: Queue not empty after timeout", file=sys.stderr)
            except Exception as e:
                print(f"Error during queue processing: {e}", file=sys.stderr)
            self._logger_provider.shutdown()

        except Exception as e:
            print(f"Error during shutdown: {e}", file=sys.stderr)


def configure_loguru_otel(
    resource,
    exporter,
    level: str = "INFO",
    max_queue_size: int = MAX_QUEUE_SIZE,
    batch_size: int = 100,
    export_interval_ms: int = 1000,
):
    """Attach an OTLP log handler to loguru."""
    handler = OTLPHandler(
        resource=resource,
        exporter=exporter,
        max_queue_size=max_queue_size,
        batch_size=batch_size,
        export_interval_ms=export_interval_ms,
    )
    logger.add(handler.sink, format="{message}", level=level)
    logger.info(
        "OTLP handler configured for loguru",
        component="observability",
        otel_level=level,
    )
