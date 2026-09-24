"""Presence converters - proto enum to string mapping."""

from uniffy_proto.presence.v1.presence_pb import PresenceStatus

STATUS_TO_STRING: dict[int, str] = {
    PresenceStatus.ONLINE: "online",
    PresenceStatus.AWAY: "away",
    PresenceStatus.DND: "dnd",
    PresenceStatus.OFFLINE: "offline",
}

STRING_TO_STATUS: dict[str, int] = {v: k for k, v in STATUS_TO_STRING.items()}


def proto_status_to_string(proto_status: int) -> str:
    return STATUS_TO_STRING.get(proto_status, "offline")


def string_to_proto_status(status: str) -> int:
    return STRING_TO_STATUS.get(status, PresenceStatus.OFFLINE)
