"""datetime <-> protobuf Timestamp helpers."""

from datetime import UTC, datetime

from google.protobuf.timestamp_pb2 import Timestamp


def datetime_to_timestamp(dt: datetime) -> Timestamp:
    timestamp = Timestamp()
    timestamp.FromDatetime(dt)
    return timestamp


def timestamp_to_datetime(ts: Timestamp) -> datetime:
    """``ToDatetime()`` returns a naive UTC value; stamp the tz so Postgres reads it correctly."""
    naive_dt = ts.ToDatetime()
    return naive_dt.replace(tzinfo=UTC)


def optional_timestamp(dt: datetime | None) -> Timestamp | None:
    if dt is None:
        return None
    return datetime_to_timestamp(dt)
