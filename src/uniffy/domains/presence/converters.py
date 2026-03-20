"""Presence converters - proto enum to string mapping."""

from uniffy_proto.presence.v1.presence_pb2 import PresenceStatus

STATUS_TO_STRING: dict[int, str] = {
    PresenceStatus.PRESENCE_STATUS_ONLINE: "online",
    PresenceStatus.PRESENCE_STATUS_AWAY: "away",
    PresenceStatus.PRESENCE_STATUS_DND: "dnd",
    PresenceStatus.PRESENCE_STATUS_OFFLINE: "offline",
}

STRING_TO_STATUS: dict[str, int] = {v: k for k, v in STATUS_TO_STRING.items()}


def proto_status_to_string(proto_status: int) -> str:
    """Convert a proto PresenceStatus enum value to a string.

    Parameters
    ----------
    proto_status : int
        Proto enum value.

    Returns
    -------
    str
        String representation ("online", "away", "dnd", "offline").

    """
    return STATUS_TO_STRING.get(proto_status, "offline")


def string_to_proto_status(status: str) -> int:
    """Convert a string status to proto PresenceStatus enum value.

    Parameters
    ----------
    status : str
        String status.

    Returns
    -------
    int
        Proto enum value.

    """
    return STRING_TO_STATUS.get(status, PresenceStatus.PRESENCE_STATUS_OFFLINE)
