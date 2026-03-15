import json
import logging
import sys
import traceback
from types import FrameType
from typing import TYPE_CHECKING, cast

from colorama import just_fix_windows_console
from loguru import logger

from .config import LogLevel

if TYPE_CHECKING:
    from .config import ObservabilityConfig

# ANSI color codes
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
CYAN = "\033[36m"
RESET = "\033[0m"

app_name = "uniffy"
app_version = "0.0.1"

# Characters that loguru interprets as markup: { } < > [ ]
# Benchmarked approaches - simple 'in' check + replace chain is fastest
# See tests/benchmarks/test_logger_benchmark.py for performance comparison


def escape_loguru_markup(s: str) -> str:
    """
    Escape special characters that loguru interprets as markup.

    Optimized with early return for strings without special characters,
    which is the common case for most log messages (e.g., access logs).

    Performance: ~1.8x faster than always running 6x replace() chains
    for clean strings (the typical case).
    """
    # Fast path: most log messages don't contain special chars
    if not ("{" in s or "}" in s or "<" in s or ">" in s or "[" in s or "]" in s):
        return s

    # Slow path: escape special characters
    return (
        s
        .replace("{", "{{")
        .replace("}", "}}")
        .replace("<", "\\<")
        .replace(">", "\\>")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )


# Mapping of log level strings to their corresponding `logging` module constants.
_LOGGING_LEVEL_MAP = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
    "CRITICAL": logging.CRITICAL,
}

# Ordered list of standard logging levels, from least severe to most severe.
# This is used to determine the next higher level when disabling a specific level.
_ORDERED_LOGGING_LEVELS = [
    logging.DEBUG,
    logging.INFO,
    logging.WARNING,
    logging.ERROR,
    logging.CRITICAL,
]


def disable_leveled_namespace(level_to_disable_str: str, namespace: str) -> None:
    """
    Sets the minimum logging level for the specified namespace to be *above*
    the provided level_to_disable_str.

    For example, calling disable_leveled_namespace("DEBUG", "kafka") will
    set the "kafka" logger's level to INFO, effectively suppressing its
    DEBUG messages. Any messages from "kafka" with severity INFO or higher
    will still be processed according to their original handler configurations.

    Args:
        level_to_disable_str: The string representation of the log level
                              to disable (e.g., "DEBUG", "INFO"). Case-insensitive.
        namespace: The name of the logger namespace (e.g., "kafka", "sqlalchemy.engine").
    """
    normalized_level_str = level_to_disable_str.upper()
    level_to_disable_val = _LOGGING_LEVEL_MAP.get(normalized_level_str)

    if level_to_disable_val is None:
        logger.warning(
            f"Invalid log level '{level_to_disable_str}' provided for namespace '{namespace}'. "
            f"Valid levels are: {', '.join(_LOGGING_LEVEL_MAP.keys())}."
        )
        return

    new_level_val = -1  # Initialize with a value that indicates it hasn't been set

    try:
        # Find the index of the level we want to disable
        current_level_index = _ORDERED_LOGGING_LEVELS.index(level_to_disable_val)
        # Set the new level to the next one in the ordered list
        if current_level_index == len(_ORDERED_LOGGING_LEVELS) - 1:
            # If CRITICAL is being disabled, set level just above CRITICAL
            new_level_val = logging.CRITICAL + 1
        else:
            new_level_val = _ORDERED_LOGGING_LEVELS[current_level_index + 1]
    except ValueError:
        logger.error(
            f"Internal consistency error: "
            f"Level {normalized_level_str} (numeric: {level_to_disable_val}) "
            f"was not found in the internal ordered list of levels. "
            f"Cannot determine the new log level for namespace '{namespace}'. "
            f"Falling back to disabling all standard levels up to "
            f"CRITICAL for this namespace."
        )
        # As a fallback, set the level very high to disable logging up to CRITICAL for the namespace.
        new_level_val = logging.CRITICAL + 1

    if new_level_val == -1:  # Should have been set by the logic above.
        logger.error(
            f"Failed to determine new log level for namespace '{namespace}' when "
            f"attempting to disable level '{normalized_level_str}'. "
            f"No changes made to logger '{namespace}'."
        )
        return

    target_logger = logging.getLogger(namespace)
    original_effective_level = target_logger.getEffectiveLevel()
    target_logger.setLevel(new_level_val)

    # logging.getLevelName might return "Level <numeric_value>" for non-standard levels.
    new_level_name = logging.getLevelName(new_level_val)
    original_level_name = logging.getLevelName(original_effective_level)

    logger.info(
        f"Disabled logging for namespace '{namespace}' at level {normalized_level_str} and below. "
        f"Logger '{namespace}' minimum level set to {new_level_name} (value: {new_level_val}). "
        f"Its previous effective minimum level was"
        f" {original_level_name} (value: {original_effective_level})."
    )


def format_extra(record: dict, color: str) -> str:
    """
    Format extra fields as key=value pairs like logrus.

    Args:
        record: The log record
        color: ANSI color code for keys

    Returns:
        str: Formatted extra fields or empty string
    """
    extra = record.get("extra", {})
    if not extra:
        return ""

    # Format as space-separated key=value pairs
    formatted_pairs = []
    for key, value in extra.items():
        safe_key = escape_loguru_markup(str(key))
        safe_value = escape_loguru_markup(str(value))

        # Quote strings containing spaces
        if isinstance(value, str) and " " in safe_value:
            formatted_pairs.append(f'{color}{safe_key}{RESET}="{safe_value}"')
        else:
            formatted_pairs.append(f"{color}{safe_key}{RESET}={safe_value}")

    return " " + " ".join(formatted_pairs) if formatted_pairs else ""


def format_info_log(record: dict) -> str:
    """Format INFO level log messages."""
    timestamp = record["time"].strftime("%m-%d %H:%M:%S")
    message = escape_loguru_markup(str(record["message"]))
    return f"{GREEN}INFO[{timestamp}]{RESET} {message}{format_extra(record, GREEN)}\n"


def format_warning_log(record: dict) -> str:
    """Format WARNING level log messages."""
    timestamp = record["time"].strftime("%m-%d %H:%M:%S")
    message = escape_loguru_markup(str(record["message"]))
    return f"{YELLOW}WARN[{timestamp}]{RESET} {message}{format_extra(record, YELLOW)}\n"


def format_error_log(record: dict) -> str:
    """Format ERROR and CRITICAL level log messages."""
    timestamp = record["time"].strftime("%m-%d %H:%M:%S")
    level = record["level"].name
    message = escape_loguru_markup(str(record["message"]))

    # Format the base log message
    base_msg = f"{RED}{level}[{timestamp}] {message}{format_extra(record, RED)}{RESET}"

    # Add exception details if present
    exception_info = record.get("exception")
    if exception_info is not None:
        exception_parts = []

        # Add exception type and value
        if exception_info.type is not None:
            exc_header = f"Exception: {exception_info.type.__name__}"
            if exception_info.value:
                exc_header += f": {escape_loguru_markup(str(exception_info.value))}"
            exception_parts.append(f"\n{RED}{exc_header}{RESET}")

        # Add traceback if available
        if exception_info.traceback:
            try:
                tb_lines = traceback.format_exception(
                    exception_info.type, exception_info.value, exception_info.traceback
                )
                formatted_tb = escape_loguru_markup("".join(tb_lines))
                exception_parts.append(f"\n{RED}{formatted_tb}{RESET}")
            except Exception as e:
                safe_error = escape_loguru_markup(str(e))
                exception_parts.append(
                    f"\n{RED}Traceback information available but "
                    f"could not be formatted (error: {safe_error}){RESET}"
                )

        base_msg += "".join(exception_parts)

    return base_msg + "\n"


def format_debug_log(record: dict) -> str:
    """Format DEBUG level log messages."""
    timestamp = record["time"].strftime("%m-%d %H:%M:%S")
    message = escape_loguru_markup(str(record["message"]))
    return f"{CYAN}DEBUG[{timestamp}]{RESET} {message}{format_extra(record, CYAN)}\n"


class InterceptHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = str(record.levelno)

        frame, depth = logging.currentframe(), 2
        while frame.f_code.co_filename == logging.__file__:
            frame = cast(FrameType, frame.f_back)
            depth += 1

        ctx = {}
        if hasattr(record, "otelTraceID"):
            ctx["otelTraceID"] = record.otelTraceID
        if hasattr(record, "otelSpanID"):
            ctx["otelSpanID"] = record.otelSpanID

        current_logger = logger
        if ctx:
            current_logger = logger.bind(**ctx)

        logger_with_opts = current_logger.opt(depth=depth, exception=record.exc_info)
        try:
            logger_with_opts.log(level, "{}", record.getMessage())
        except Exception as e:
            safe_msg = getattr(record, "msg", None) or str(record)
            logger_with_opts.warning(
                "Exception logging the following native logger message: {}, {!r}",
                safe_msg,
                e,
            )


def serialize(record):
    subset = {
        "time": record["time"],
        "app": app_name,
        "v": app_version,
        "level": record["level"].name,
        "msg": record["message"],
        "extra": record["extra"],
        "func": record["function"],
        "line": record["line"],
        "pkg": record["name"],
    }

    e = record["exception"]

    if e is not None:
        exception = {
            "t": None if e.type is None else e.type.__name__,
            "value": e.value,
            "traceback": bool(e.traceback),
        }
        subset["exc"] = exception

    return json.dumps(subset, default=str, ensure_ascii=False)


def sink(message):
    serialized = serialize(message.record)
    print(serialized, file=sys.stderr)


def configure_loguru(config: ObservabilityConfig) -> None:
    """Configure loguru logger with custom format similar to golang logrus."""

    global app_name, app_version
    app_name = config.app_name
    app_version = config.app_version

    logger.remove()
    root_logger = logging.getLogger()
    root_logger.handlers = [InterceptHandler()]
    root_logger.setLevel(0)

    log_level_table = {
        "INFO": logging.INFO,
        "DEBUG": logging.DEBUG,
        "WARNING": logging.WARNING,
        "WARN": logging.WARNING,
        "ERROR": logging.ERROR,
        "CRITICAL": logging.CRITICAL,
    }
    try:
        logging_level = log_level_table[config.console_log_level]
    except KeyError:
        logging_level = logging.INFO

    loggers_to_intercept = [
        "alembic",
        "alembic.runtime.migration",
        "httpx",
        "primp",
        "sqlalchemy",
        "sqlalchemy.engine",
        "sqlalchemy.pool",
        "uvicorn",
        "uvicorn.error",
        "fastapi",
    ]
    for logger_name in loggers_to_intercept:
        level = logging_level
        if "sql" in logger_name:
            level = log_level_table[config.sqlalchemy_level]

        mod_logger = logging.getLogger(logger_name)
        mod_logger.handlers = [InterceptHandler(level=level)]
        mod_logger.propagate = False

    # Disable uvicorn access logs - we have our own ConnectRPC access logging
    logging.getLogger("uvicorn.access").handlers = []
    logging.getLogger("uvicorn.access").propagate = False

    # Suppress DEBUG/INFO logs from HTTP transport libraries (too noisy)
    # These produce verbose connection-level logs that clutter output
    http_loggers = ["httpx", "httpcore", "httpcore.connection", "httpcore.http11"]
    for http_logger_name in http_loggers:
        http_logger = logging.getLogger(http_logger_name)
        http_logger.setLevel(logging.WARNING)
        http_logger.handlers = []
        http_logger.propagate = False

    if config.console_log_type == "json":
        logger.add(
            sink,
            level=config.console_log_level.value,
            backtrace=True,
            serialize=True,
            diagnose=True,
        )
        logger.info("json sync logger configured", component="observability")
    else:
        just_fix_windows_console()
        loggers_config = {
            "handlers": [
                # Info logs
                {
                    "sink": sys.stdout,
                    "format": format_info_log,
                    "filter": lambda record: record["level"].name == "INFO",
                    "level": "INFO",
                    "colorize": False,
                    "diagnose": True,
                },
                # Warning logs
                {
                    "sink": sys.stdout,
                    "format": format_warning_log,
                    "filter": lambda record: record["level"].name == "WARNING",
                    "level": "WARNING",
                    "colorize": False,
                    "diagnose": True,
                },
                # Error and Critical logs
                {
                    "sink": sys.stderr,
                    "format": format_error_log,
                    "filter": lambda record: record["level"].name in ["ERROR", "CRITICAL"],
                    "level": "ERROR",
                    "colorize": False,
                    "diagnose": True,
                    "backtrace": True,
                    "catch": True,
                },
            ],
        }

        # Apply the configuration
        for handler in loggers_config["handlers"]:
            logger.add(**handler)

        if config.console_log_level == LogLevel.DEBUG:
            logger.add(
                sys.stdout,
                level="DEBUG",
                filter=lambda record: record["level"].name == "DEBUG",
                diagnose=True,
                colorize=False,
                format=format_debug_log,
            )
