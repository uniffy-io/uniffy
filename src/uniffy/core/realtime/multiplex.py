"""Hocuspocus V2 framing for multiplexed Yjs.

Each wire frame is ``[VarString docName][y-protocols frame bytes]``; ``VarString``
matches lib0's ``varString`` encoding (varint byte length prefix + UTF-8). The
framing is byte-compatible with the lib0 helpers JS clients ship.
"""

from __future__ import annotations

_CONTINUATION_BIT = 0x80
_PAYLOAD_MASK = 0x7F
# Hard cap on docname bytes; defends against gigabyte allocations from a malicious varuint length.
# Real docnames are ``"<content_type>:<uuid>"``, well under 100 bytes.
_MAX_DOCNAME_BYTES = 4096


def write_var_uint(value: int) -> bytes:
    """Encode an unsigned int with lib0's 7-bits-per-byte varint."""
    if value < 0:
        raise ValueError(f"var_uint expects non-negative int, got {value}")
    out = bytearray()
    while value > _PAYLOAD_MASK:
        out.append((value & _PAYLOAD_MASK) | _CONTINUATION_BIT)
        value >>= 7
    out.append(value & _PAYLOAD_MASK)
    return bytes(out)


def read_var_uint(buf: bytes, offset: int = 0) -> tuple[int, int]:
    """Decode a lib0 varint; returns ``(value, next_offset)``."""
    if offset < 0 or offset >= len(buf):
        raise ValueError(f"var_uint: offset {offset} out of range for buffer of len {len(buf)}")
    value = 0
    shift = 0
    pos = offset
    max_bytes = 8
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
    body = value.encode("utf-8")
    return write_var_uint(len(body)) + body


def read_var_string(buf: bytes, offset: int = 0) -> tuple[str, int]:
    """Decode a VarString; rejects bodies longer than :data:`_MAX_DOCNAME_BYTES`."""
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
    """Decode the docname without consuming the y-protocols payload;
    returns ``(doc_name, payload_offset)``.
    """
    return read_var_string(buf, 0)


def encode_doc_frame(doc_name: str, body: bytes) -> bytes:
    """Wrap a y-protocols frame with a docname VarString prefix. Only
    allocation on the outbound hot path.
    """
    return write_var_string(doc_name) + body
