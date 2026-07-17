"""Route arq's logging through loguru — the platform logger — without rewriting its call sites.

arq calls its module loggers with ``%``-style args and ``exc_info=`` (the stdlib shape); this adapter
translates that to loguru, so the vendored source stays a drop-in for upstream and re-vendoring stays a
clean re-diff. Each module imports ``logger`` from here instead of ``logging.getLogger(...)``.
"""

import logging
from typing import Any

from loguru import logger as _loguru

# stdlib numeric levels → loguru level names (for the rare logger.log(level, ...) path).
_LEVELS = {
    logging.DEBUG: "DEBUG",
    logging.INFO: "INFO",
    logging.WARNING: "WARNING",
    logging.ERROR: "ERROR",
    logging.CRITICAL: "CRITICAL",
}


class _LoguruAdapter:
    """A stdlib-logging-shaped facade over loguru (``%`` formatting + ``exc_info`` → loguru)."""

    @staticmethod
    def _emit(level: str, msg: object, args: tuple[Any, ...], kwargs: dict[str, Any]) -> None:
        text = str(msg)
        if args:
            try:
                text = text % args  # arq formats with %-args; resolve here so loguru gets a final string
            except Exception:
                text = f"{text} {args!r}"
        _loguru.opt(depth=2, exception=kwargs.get("exc_info", False)).log(level, text)

    def debug(self, msg: object, *args: Any, **kwargs: Any) -> None:
        self._emit("DEBUG", msg, args, kwargs)

    def info(self, msg: object, *args: Any, **kwargs: Any) -> None:
        self._emit("INFO", msg, args, kwargs)

    def warning(self, msg: object, *args: Any, **kwargs: Any) -> None:
        self._emit("WARNING", msg, args, kwargs)

    def error(self, msg: object, *args: Any, **kwargs: Any) -> None:
        self._emit("ERROR", msg, args, kwargs)

    def critical(self, msg: object, *args: Any, **kwargs: Any) -> None:
        self._emit("CRITICAL", msg, args, kwargs)

    def exception(self, msg: object, *args: Any, **kwargs: Any) -> None:
        kwargs.setdefault("exc_info", True)
        self._emit("ERROR", msg, args, kwargs)

    def log(self, level: Any, msg: object, *args: Any, **kwargs: Any) -> None:
        self._emit(level if isinstance(level, str) else _LEVELS.get(level, "INFO"), msg, args, kwargs)


logger = _LoguruAdapter()
