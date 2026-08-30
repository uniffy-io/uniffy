import logging
import sys
import traceback
from types import FrameType
from typing import cast

from colorama import just_fix_windows_console
from loguru import logger

from uniffy.core.json_codec import dumps_str

try:
    from loguru._recattrs import RecordException
except ImportError:  # loguru internals relocated; the exc_info patcher degrades to a no-op
    RecordException = None

from .config import LoggingConfig, LogLevel

GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
CYAN = "\033[36m"
RESET = "\033[0m"

_app_name = "uniffy"
_app_version = "0.0.1"


def escape_loguru_markup(s: str) -> str:
    """Escape characters Loguru treats as markup."""
    if not ("{" in s or "}" in s or "<" in s or ">" in s or "[" in s or "]" in s):  # noqa: PLR2004
        return s

    return (
        s
        .replace("{", "{{")
        .replace("}", "}}")
        .replace("<", "\\<")
        .replace(">", "\\>")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )


def format_extra(record: dict, color: str) -> str:
    extra = record.get("extra", {})
    if not extra:
        return ""

    formatted_pairs = []
    for key, value in extra.items():
        safe_key = escape_loguru_markup(str(key))
        safe_value = escape_loguru_markup(str(value))

        if isinstance(value, str) and " " in safe_value:  # noqa: PLR2004
            formatted_pairs.append(f'{color}{safe_key}{RESET}="{safe_value}"')
        else:
            formatted_pairs.append(f"{color}{safe_key}{RESET}={safe_value}")

    return " " + " ".join(formatted_pairs) if formatted_pairs else ""


def format_info_log(record: dict) -> str:
    timestamp = record["time"].strftime("%m-%d %H:%M:%S")
    message = escape_loguru_markup(str(record["message"]))
    return f"{GREEN}INFO[{timestamp}]{RESET} {message}{format_extra(record, GREEN)}\n"


def format_warning_log(record: dict) -> str:
    timestamp = record["time"].strftime("%m-%d %H:%M:%S")
    message = escape_loguru_markup(str(record["message"]))
    return f"{YELLOW}WARN[{timestamp}]{RESET} {message}{format_extra(record, YELLOW)}\n"


def format_error_log(record: dict) -> str:
    timestamp = record["time"].strftime("%m-%d %H:%M:%S")
    level = record["level"].name
    message = escape_loguru_markup(str(record["message"]))

    base_msg = f"{RED}{level}[{timestamp}] {message}{format_extra(record, RED)}{RESET}"

    exception_info = record.get("exception")
    if exception_info is not None:
        exception_parts = []

        if exception_info.type is not None:
            exc_header = f"Exception: {exception_info.type.__name__}"
            if exception_info.value:
                exc_header += f": {escape_loguru_markup(str(exception_info.value))}"
            exception_parts.append(f"\n{RED}{exc_header}{RESET}")

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

        logger_with_opts = logger.opt(depth=depth, exception=record.exc_info)
        try:
            logger_with_opts.log(level, "{}", record.getMessage())
        except Exception as e:
            safe_msg = getattr(record, "msg", None) or str(record)
            logger_with_opts.warning(
                "Exception logging the following native logger message: {}, {!r}",
                safe_msg,
                e,
            )


def _capture_exc_info_from_extra(record) -> None:
    """Capture the traceback from stray stdlib-style ``exc_info=True`` calls."""
    flagged = record["extra"].pop("exc_info", None)
    if flagged and record["exception"] is None and RecordException is not None:
        type_, value, tb = sys.exc_info()
        if type_ is not None:
            record["exception"] = RecordException(type_, value, tb)


def serialize(record):
    subset = {
        "time": record["time"],
        "app": _app_name,
        "v": _app_version,
        "level": record["level"].name,
        "msg": record["message"],
        "func": record["function"],
        "line": record["line"],
        "pkg": record["name"],
    }

    # Promote structured kwargs (user_id, duration_ms, http, error_code, ...) to
    # top-level keys so log aggregators index them directly instead of under a
    # nested path. Reserved keys above win on collision.
    for key, value in record["extra"].items():
        subset.setdefault(key, value)

    e = record["exception"]

    if e is not None:
        exception = {
            "t": None if e.type is None else e.type.__name__,
            "value": e.value,
            "traceback": bool(e.traceback),
        }
        subset["exc"] = exception

    return dumps_str(subset, default=str)


def sink(message):
    serialized = serialize(message.record)
    print(serialized, file=sys.stderr)


def configure_logging(config: LoggingConfig) -> None:
    """Configure Loguru and bridge standard-library logging into it."""
    global _app_name, _app_version
    _app_name = config.app_name
    _app_version = config.app_version

    logger.remove()
    logger.configure(patcher=_capture_exc_info_from_extra)
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
        "_granian",
        "fastapi",
    ]
    for logger_name in loggers_to_intercept:
        level = logging_level
        if "sql" in logger_name:  # noqa: PLR2004
            level = logging.INFO

        mod_logger = logging.getLogger(logger_name)
        mod_logger.handlers = [InterceptHandler(level=level)]
        mod_logger.propagate = False

    # ConnectRPC interceptor already emits access logs.
    logging.getLogger("granian.access").handlers = []
    logging.getLogger("granian.access").propagate = False

    # HTTP transport DEBUG/INFO is too verbose for production.
    http_loggers = ["httpx", "httpcore", "httpcore.connection", "httpcore.http11"]
    for http_logger_name in http_loggers:
        http_logger = logging.getLogger(http_logger_name)
        http_logger.setLevel(logging.WARNING)
        http_logger.handlers = []
        http_logger.propagate = False

    if config.console_log_type == "json":  # noqa: PLR2004
        # The custom `sink` already serializes via `serialize()`, so loguru's own
        # `serialize=True` is redundant. `diagnose=True` is intentionally off: it
        # injects local variable values into tracebacks, which leaks data in prod.
        logger.add(
            sink,
            level=config.console_log_level.value,
            backtrace=True,
        )
        logger.info("json logger configured", component="observability")
    else:
        just_fix_windows_console()
        loggers_config = {
            "handlers": [
                {
                    "sink": sys.stdout,
                    "format": format_info_log,
                    "filter": lambda record: record["level"].name == "INFO",  # noqa: PLR2004
                    "level": "INFO",
                    "colorize": False,
                    "diagnose": True,
                },
                {
                    "sink": sys.stdout,
                    "format": format_warning_log,
                    "filter": lambda record: record["level"].name == "WARNING",  # noqa: PLR2004
                    "level": "WARNING",
                    "colorize": False,
                    "diagnose": True,
                },
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

        for handler in loggers_config["handlers"]:
            logger.add(**handler)

        if config.console_log_level == LogLevel.DEBUG:
            logger.add(
                sys.stdout,
                level="DEBUG",
                filter=lambda record: record["level"].name == "DEBUG",  # noqa: PLR2004
                diagnose=True,
                colorize=False,
                format=format_debug_log,
            )
