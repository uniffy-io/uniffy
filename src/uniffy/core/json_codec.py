from collections.abc import Callable
from typing import Any

import orjson

JSONDecodeError = orjson.JSONDecodeError
OPTION_INDENT_2 = orjson.OPT_INDENT_2

type JsonDefault = Callable[[Any], Any]
type JsonInput = str | bytes | bytearray | memoryview


def dumps_bytes(
    value: Any,
    *,
    default: JsonDefault | None = None,
    option: int = 0,
) -> bytes:
    return orjson.dumps(value, default=default, option=option)


def dumps_str(
    value: Any,
    *,
    default: JsonDefault | None = None,
    option: int = 0,
) -> str:
    return dumps_bytes(value, default=default, option=option).decode()


def loads(data: JsonInput) -> Any:
    return orjson.loads(data)
