from uniffy.core.json_codec import dumps_str, loads
from uniffy.core.models.login.user import User
from uniffy.core.realtime.limits import MAX_AWARENESS_BYTES
from uniffy.core.realtime.multiplex import (
    read_var_string,
    read_var_uint,
    write_var_string,
    write_var_uint,
)
from uniffy.core.realtime.state import ClientHandle
from uniffy.infrastructure.database.session import open_session


async def authenticated_awareness(payload: bytes, handle: ClientHandle) -> bytes:
    size, offset = read_var_uint(payload, 1)
    if offset + size != len(payload):
        raise ValueError("Invalid awareness length")
    count, offset = read_var_uint(payload, offset)
    if count != 1:
        raise ValueError("Only own awareness may be published")
    client_id, offset = read_var_uint(payload, offset)
    clock, offset = read_var_uint(payload, offset)
    raw, offset = read_var_string(payload, offset, max_bytes=MAX_AWARENESS_BYTES)
    if offset != len(payload):
        raise ValueError("Invalid awareness trailing bytes")
    state = loads(raw)
    if state is not None and not isinstance(state, dict):
        raise ValueError("Invalid awareness state")
    if handle.awareness_client_id is not None and handle.awareness_client_id != client_id:
        raise ValueError("Awareness client changed")
    handle.awareness_client_id = client_id if state is not None else None
    if state is not None:
        if handle.awareness_user is None:
            async with open_session() as db:
                user = await db.get(User, handle.user_id)
                handle.awareness_user = {
                    "id": str(handle.user_id),
                    "name": (user.full_name or user.username) if user else "Collaborator",
                    "hasAvatar": bool(user and user.avatar_key),
                }
        state["user"] = handle.awareness_user
    update = (
        write_var_uint(1)
        + write_var_uint(client_id)
        + write_var_uint(clock)
        + write_var_string(dumps_str(state))
    )
    return bytes([1]) + write_var_uint(len(update)) + update
