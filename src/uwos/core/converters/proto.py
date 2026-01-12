"""
Proto conversion utilities.

Provides common conversion functions between protobuf types
and Python/domain types.
"""

from datetime import datetime

from google.protobuf.timestamp_pb2 import Timestamp


def datetime_to_timestamp(dt: datetime) -> Timestamp:
    """
    Convert datetime to protobuf Timestamp.

    Parameters
    ----------
    dt : datetime
        Python datetime object (should be timezone-aware).

    Returns
    -------
    Timestamp
        Protobuf timestamp.

    """
    timestamp = Timestamp()
    timestamp.FromDatetime(dt)
    return timestamp


def timestamp_to_datetime(ts: Timestamp) -> datetime:
    """
    Convert protobuf Timestamp to datetime.

    Parameters
    ----------
    ts : Timestamp
        Protobuf timestamp.

    Returns
    -------
    datetime
        Python datetime object (UTC).

    """
    return ts.ToDatetime()


def optional_timestamp(dt: datetime | None) -> Timestamp | None:
    """
    Convert optional datetime to optional Timestamp.

    Parameters
    ----------
    dt : datetime | None
        Optional Python datetime.

    Returns
    -------
    Timestamp | None
        Protobuf timestamp or None.

    """
    if dt is None:
        return None
    return datetime_to_timestamp(dt)
