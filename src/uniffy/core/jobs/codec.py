"""JSON codec for queued job payloads and results.

Any client with the Valkey password can write to a queue, and workers parse whatever a queue
holds, so the payload format must never be able to run code. Arguments are the JSON values
handlers accept: strings, numbers, booleans, None, lists and string-keyed dicts.
"""

from typing import Any

from uniffy.core.json_codec import dumps_bytes, loads

_SCALARS = (str, int, float, bool, type(None))
_ARGUMENT_FIELDS = {"a": "job arguments", "k": "job keyword arguments"}
_RESULT_FIELD = "r"


def serialize_job_payload(data: dict[str, Any]) -> bytes:
    """Encode an ARQ job or result dict.

    Raises ``TypeError`` for an argument that is not a JSON value, so a producer passing a UUID,
    a datetime or bytes fails at enqueue instead of changing type on the way to the handler.
    """
    for field, label in _ARGUMENT_FIELDS.items():
        if field in data:
            _require_json_value(data[field], label)
    if _RESULT_FIELD in data:
        data = {**data, _RESULT_FIELD: _result_value(data[_RESULT_FIELD])}
    return dumps_bytes(data, default=_render_unknown)


def deserialize_job_payload(raw: bytes) -> dict[str, Any]:
    """Decode a payload this codec wrote; anything that is not a JSON object is refused."""
    data = loads(raw)
    if not isinstance(data, dict):
        raise ValueError("job payload is not a JSON object")
    return data


def _require_json_value(value: Any, path: str) -> None:
    if isinstance(value, _SCALARS):
        return
    if isinstance(value, list | tuple):
        for index, item in enumerate(value):
            _require_json_value(item, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError(f"{path} has a non-string key {key!r}")
            _require_json_value(item, f"{path}[{key!r}]")
        return
    raise TypeError(
        f"{path} holds {type(value).__name__}; job arguments are JSON values, pass ids as str"
    )


def _result_value(value: Any) -> Any:
    # A failed job's result is its exception; the record keeps what it was, not the object.
    if isinstance(value, BaseException):
        return {"error": type(value).__name__, "message": str(value)}
    return value


def _render_unknown(value: Any) -> str:
    # Only results reach here: arguments were checked above. A result JSON cannot carry stays
    # readable as text instead of failing the record.
    return str(value)
