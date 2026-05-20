"""Hocuspocus V2 framing for multiplexed Yjs over a single WebSocket.

Each frame on the wire is ``[VarString docName][y-protocols frame bytes]``
where ``VarString`` matches lib0's ``varString`` encoding (varint byte
length prefix followed by UTF-8 bytes). The framing is byte-compatible
with Hocuspocus V2 so the Python server interoperates with the lib0
helpers JS clients ship.
"""

from __future__ import annotations

_CONTINUATION_BIT = 0x80
_PAYLOAD_MASK = 0x7F
_MAX_DOCNAME_BYTES = 4096
"""Hard cap on the UTF-8 byte length of a docname. Defensive bound that
prevents a malicious peer from inducing gigabyte allocations via the
varuint length. Real docnames are ``"<content_type>:<uuid>"`` -- well
under 100 bytes."""


def write_var_uint(value: int) -> bytes:
    """Encode an unsigned int with lib0's 7-bits-per-byte varint.

    MSB of each byte is the continuation bit. Negative values raise.
    """
    if value < 0:
        raise ValueError(f"var_uint expects non-negative int, got {value}")
    out = bytearray()
    while value > _PAYLOAD_MASK:
        out.append((value & _PAYLOAD_MASK) | _CONTINUATION_BIT)
        value >>= 7
    out.append(value & _PAYLOAD_MASK)
    return bytes(out)


def read_var_uint(buf: bytes, offset: int = 0) -> tuple[int, int]:
    """Decode a lib0 varint starting at ``offset``.

    Returns ``(value, next_offset)``. Raises ``ValueError`` on truncated
    input or an over-long varint.
    """
    if offset < 0 or offset >= len(buf):
        raise ValueError(f"var_uint: offset {offset} out of range for buffer of len {len(buf)}")
    value = 0
    shift = 0
    pos = offset
    max_bytes = 8  # well over the largest var_uint we ever encode
    while pos < len(buf):
        byte = buf[pos]
        pos += 1
        value |= (byte & _PAYLOAD_MASK) << shift
        if byte & _CONTINUATION_BIT == 0:
            return value, pos
        shift += 7
        if pos - offset > max_bytes:
            raise ValueError("var_uint: encoding longer than supported max")
    raise ValueError("var_uint: buffer ended before varint terminator")


def write_var_string(value: str) -> bytes:
    """Encode ``value`` as ``[var_uint utf8_byte_length][utf8 bytes]``."""
    body = value.encode("utf-8")
    return write_var_uint(len(body)) + body


def read_var_string(buf: bytes, offset: int = 0) -> tuple[str, int]:
    """Decode a VarString starting at ``offset``.

    Returns ``(value, next_offset)``. Rejects bodies longer than
    :data:`_MAX_DOCNAME_BYTES`.
    """
    length, pos = read_var_uint(buf, offset)
    if length > _MAX_DOCNAME_BYTES:
        raise ValueError(f"var_string: declared length {length} exceeds cap {_MAX_DOCNAME_BYTES}")
    end = pos + length
    if end > len(buf):
        raise ValueError(
            f"var_string: declared length {length} runs past buffer "
            f"(have {len(buf) - pos} bytes after the length prefix)"
        )
    return buf[pos:end].decode("utf-8"), end


def peek_var_string(buf: bytes) -> tuple[str, int]:
    """Decode the docname WITHOUT consuming the y-protocols payload.

    Returns ``(doc_name, payload_offset)`` so callers can dispatch
    ``buf[payload_offset:]`` straight to the per-doc handler without
    re-encoding.
    """
    return read_var_string(buf, 0)


def encode_doc_frame(doc_name: str, body: bytes) -> bytes:
    """Wrap a y-protocols frame with a docname VarString prefix.

    Only allocation on the outbound hot path; callers must NOT
    concatenate again upstream.
    """
    return write_var_string(doc_name) + body
