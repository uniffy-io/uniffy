"""datetime <-> protobuf Timestamp helpers."""

from datetime import UTC, datetime

from protobuf.wkt import Timestamp


def datetime_to_timestamp(dt: datetime) -> Timestamp:
    # Naive database values represent UTC, regardless of the process timezone.
    return Timestamp.from_datetime(dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt)


def timestamp_to_datetime(ts: Timestamp) -> datetime:
    # Datetimes carry microseconds; discard sub-microsecond precision on conversion.
    return datetime.fromtimestamp(ts.seconds, UTC).replace(microsecond=ts.nanos // 1000)


def optional_timestamp(dt: datetime | None) -> Timestamp | None:
    if dt is None:
        return None
    return datetime_to_timestamp(dt)
