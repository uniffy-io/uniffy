// Hocuspocus V2 framing helpers (JS side).
// Wire-byte-compatible with `core/realtime/multiplex.py`.
// Frame = [VarString docName][y-protocols frame bytes].

const CONTINUATION_BIT = 0x80;
const PAYLOAD_MASK = 0x7f;

function writeVarUint(value: number): Uint8Array {
  if (value < 0) {
    throw new Error(`var_uint expects non-negative int, got ${value}`);
  }
  const out: number[] = [];
  while (value > PAYLOAD_MASK) {
    out.push((value & PAYLOAD_MASK) | CONTINUATION_BIT);
    value = value >>> 7;
  }
  out.push(value & PAYLOAD_MASK);
  return new Uint8Array(out);
}

function readVarUint(buf: Uint8Array, offset = 0): { value: number; nextOffset: number } {
  if (offset < 0 || offset >= buf.length) {
    throw new Error(`var_uint: offset ${offset} out of range for buffer of len ${buf.length}`);
  }
  let value = 0;
  let shift = 0;
  let pos = offset;
  const maxBytes = 8;
  while (pos < buf.length) {
    const byte = buf[pos];
    pos += 1;
    value |= (byte & PAYLOAD_MASK) << shift;
    if ((byte & CONTINUATION_BIT) === 0) {
      return { value, nextOffset: pos };
    }
    shift += 7;
    if (pos - offset > maxBytes) {
      throw new Error("var_uint: encoding longer than supported max");
    }
  }
  throw new Error("var_uint: buffer ended before varint terminator");
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function writeVarString(value: string): Uint8Array {
  const body = utf8Encoder.encode(value);
  const length = writeVarUint(body.length);
  const out = new Uint8Array(length.length + body.length);
  out.set(length, 0);
  out.set(body, length.length);
  return out;
}

const MAX_DOCNAME_BYTES = 4096;

function readVarString(buf: Uint8Array, offset = 0): { value: string; nextOffset: number } {
  const { value: length, nextOffset } = readVarUint(buf, offset);
  if (length > MAX_DOCNAME_BYTES) {
    throw new Error(`var_string: declared length ${length} exceeds cap ${MAX_DOCNAME_BYTES}`);
  }
  const end = nextOffset + length;
  if (end > buf.length) {
    throw new Error(
      `var_string: declared length ${length} runs past buffer ` +
        `(have ${buf.length - nextOffset} bytes after the length prefix)`,
    );
  }
  const value = utf8Decoder.decode(buf.subarray(nextOffset, end));
  return { value, nextOffset: end };
}

export function peekVarString(buf: Uint8Array): { docName: string; payloadOffset: number } {
  const { value, nextOffset } = readVarString(buf, 0);
  return { docName: value, payloadOffset: nextOffset };
}

export function encodeDocFrame(docName: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const prefix = writeVarString(docName);
  const out = new Uint8Array(prefix.length + body.length);
  out.set(prefix, 0);
  out.set(body, prefix.length);
  return out;
}

export const MULTIPLEX_INTERNALS = {
  writeVarUint,
  readVarUint,
  writeVarString,
  readVarString,
};
