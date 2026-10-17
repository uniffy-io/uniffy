import pickle
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from uniffy.core.jobs.codec import deserialize_job_payload, serialize_job_payload
from uniffy.vendor.arq.jobs import (
    DeserializationError,
    SerializationError,
    deserialize_job,
    deserialize_result,
    serialize_job,
    serialize_result,
)

_ENQUEUED_MS = 1_700_000_000_000


def test_arguments_round_trip_as_json_values() -> None:
    raw = serialize_job(
        "send_email",
        ("a@example.com", 3, 1.5, True, None, ["x", {"k": [1]}]),
        {"organization_id": None, "attempt": 2},
        None,
        _ENQUEUED_MS,
        serializer=serialize_job_payload,
    )

    assert raw.startswith(b"{")
    job = deserialize_job(raw, deserializer=deserialize_job_payload)
    assert job.function == "send_email"
    assert job.args == ("a@example.com", 3, 1.5, True, None, ["x", {"k": [1]}])
    assert job.kwargs == {"organization_id": None, "attempt": 2}
    assert job.enqueue_time == datetime.fromtimestamp(_ENQUEUED_MS / 1000, tz=UTC)


@pytest.mark.parametrize(
    "argument",
    [uuid4(), datetime.now(UTC), b"bytes", {"member"}, object()],
    ids=["uuid", "datetime", "bytes", "set", "object"],
)
def test_an_argument_that_is_not_a_json_value_is_refused_at_enqueue(argument: object) -> None:
    with pytest.raises(TypeError, match="job arguments\\[1\\]\\[0\\] holds"):
        serialize_job_payload({"t": None, "f": "f", "a": ["ok", [argument]], "k": {}, "et": 1})

    with pytest.raises(SerializationError):
        serialize_job("f", (argument,), {}, None, _ENQUEUED_MS, serializer=serialize_job_payload)


def test_a_keyword_argument_with_a_non_string_key_is_refused() -> None:
    with pytest.raises(TypeError, match="non-string key 1"):
        serialize_job_payload({"t": None, "f": "f", "a": [], "k": {"n": {1: "x"}}, "et": 1})


def test_a_failed_result_keeps_its_error_as_text() -> None:
    raw = serialize_result(
        "f", ["x"], {}, 1, _ENQUEUED_MS, False, RuntimeError("boom"), 2, 3, "ref", "q",
        job_id="job", serializer=serialize_job_payload,
    )

    assert raw is not None
    result = deserialize_result(raw, deserializer=deserialize_job_payload)
    assert result.success is False
    assert result.result == {"error": "RuntimeError", "message": "boom"}
    assert result.args == ("x",)


def test_a_result_json_cannot_carry_is_kept_as_text() -> None:
    raw = serialize_result(
        "f", [], {}, 1, _ENQUEUED_MS, True, {"member"}, 2, 3, "ref", "q",
        job_id="job", serializer=serialize_job_payload,
    )

    assert raw is not None
    result = deserialize_result(raw, deserializer=deserialize_job_payload)
    assert result.success is True
    assert result.result == "{'member'}"


def test_a_pickled_payload_never_reaches_the_worker() -> None:
    raw = pickle.dumps({"t": None, "f": "f", "a": (), "k": {}, "et": _ENQUEUED_MS})

    with pytest.raises(DeserializationError):
        deserialize_job(raw, deserializer=deserialize_job_payload)


def test_a_json_payload_that_is_not_an_object_is_refused() -> None:
    with pytest.raises(ValueError, match="not a JSON object"):
        deserialize_job_payload(b"[1, 2]")


async def test_a_job_handle_reads_queued_json_through_its_pool_codec() -> None:
    from uniffy.vendor.arq.constants import job_key_prefix
    from uniffy.vendor.arq.jobs import Job

    raw = serialize_job("f", ("x",), {"n": 1}, None, _ENQUEUED_MS, serializer=serialize_job_payload)

    class Pool:
        job_deserializer = staticmethod(deserialize_job_payload)

        async def get(self, key: str) -> bytes | None:
            return raw if key == job_key_prefix + "job" else None

        async def zscore(self, queue: str, job_id: str) -> float | None:
            return 1.0

    info = await Job("job", Pool(), _queue_name="queue").info()  # type: ignore[arg-type]

    assert info is not None
    assert info.function == "f"
    assert info.args == ("x",)
    assert info.kwargs == {"n": 1}
