import * as encoding from "lib0/encoding";
import { decodeUtf8, encodeUtf8 } from "lib0/string";

export const CANONICAL_SUBPROTOCOL = "uniffy.realtime.v2";

// The server refused a write it may accept later; the client keeps it and retries.
export const UNAVAILABLE_REASON = "unavailable";
// The server already holds different bytes under this update id.
export const UPDATE_CONFLICT_REASON = "update conflict";

export const WS_CLOSE_NORMAL = 1000;
export const WS_CLOSE_MESSAGE_TOO_BIG = 1009;
export const WS_CLOSE_UNAUTHENTICATED = 4401;
export const WS_CLOSE_FORBIDDEN = 4403;
// The server bounds a socket by the lifetime of the token that opened it.
// Refresh, then reconnect - this is not a revocation.
export const WS_CLOSE_REAUTH_REQUIRED = 4409;
export const WS_CLOSE_TOKEN_REVOKED = 4410;
// The server speaks a protocol this build does not; only an app update can fix that.
export const WS_CLOSE_UPGRADE_REQUIRED = 4426;

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "offline"
  | "access_lost"
  | "permission_lost"
  | "update_rejected"
  | "token_revoked"
  | "upgrade_required";

export function statusFromCloseCode(code: number): RealtimeStatus | null {
  switch (code) {
    case WS_CLOSE_FORBIDDEN:
      return "access_lost";
    case WS_CLOSE_TOKEN_REVOKED:
      return "token_revoked";
    case WS_CLOSE_UPGRADE_REQUIRED:
      return "upgrade_required";
    default:
      return null;
  }
}

export const MESSAGE_GENERATION = 5;
export const MESSAGE_UPDATE = 6;
// Committed: PostgreSQL holds the update. Never sent for a buffer-only append.
export const MESSAGE_COMMITTED = 7;
export const MESSAGE_ACCEPTED_RECEIPT = 11;
export const MESSAGE_CHECKPOINT_PROGRESS = 12;
export const MESSAGE_SESSION_STATE = 13;

const MAX_WIRE_STRING_BYTES = 128;
// A varuint longer than eight bytes exceeds Number.MAX_SAFE_INTEGER.
const MAX_WIRE_INTEGER_BYTES = 8;

/** The server buffer holds the update; only checkpoint progress proves PostgreSQL does. */
export interface AcceptedReceipt {
  readonly updateId: string;
  readonly generation: string;
  readonly epoch: string;
  readonly acceptedSequence: number;
}

export interface CheckpointProgress {
  readonly generation: string;
  readonly epoch: string;
  readonly coveredSequence: number;
  readonly checkpointRevision: number;
}

export interface SessionState {
  readonly generation: string;
  readonly epoch: string;
  readonly headSequence: number;
  readonly checkpointSequence: number;
  readonly checkpointRevision: number;
}

class FrameReader {
  private offset = 0;

  constructor(
    private readonly frame: Uint8Array,
    messageType: number,
  ) {
    const kind = this.integer();
    if (kind !== messageType) throw new RangeError(`message type ${kind}, expected ${messageType}`);
  }

  integer(): number {
    let value = 0;
    for (let index = 0; index < MAX_WIRE_INTEGER_BYTES; index++) {
      if (this.offset >= this.frame.length) throw new RangeError("frame ends inside an integer");
      const byte = this.frame[this.offset++];
      value += (byte & 0x7f) * 2 ** (7 * index);
      if (byte < 0x80) {
        if (value > Number.MAX_SAFE_INTEGER) throw new RangeError("integer exceeds 2^53 - 1");
        return value;
      }
    }
    throw new RangeError("integer exceeds 2^53 - 1");
  }

  string(): string {
    const length = this.integer();
    if (length > MAX_WIRE_STRING_BYTES) throw new RangeError(`string of ${length} bytes`);
    const end = this.offset + length;
    if (end > this.frame.length) throw new RangeError("string runs past the frame");
    const value = decodeUtf8(this.frame.subarray(this.offset, end));
    this.offset = end;
    return value;
  }

  end(): void {
    if (this.offset !== this.frame.length) throw new RangeError("trailing bytes after the message");
  }
}

function frameWriter(messageType: number) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageType);
  return {
    string(value: string) {
      const bytes = encodeUtf8(value);
      if (bytes.length > MAX_WIRE_STRING_BYTES) {
        throw new RangeError(`string of ${bytes.length} bytes`);
      }
      encoding.writeVarUint8Array(encoder, bytes);
      return this;
    },
    integer(value: number) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`integer ${value} outside 0..2^53 - 1`);
      }
      encoding.writeVarUint(encoder, value);
      return this;
    },
    bytes: () => encoding.toUint8Array(encoder),
  };
}

// Zero means "nothing covered" in progress and session state, so no update can hold it.
function checkAcceptedSequence(sequence: number): void {
  if (sequence < 1) throw new RangeError("accepted sequence starts at 1");
}

function checkWatermark(headSequence: number, checkpointSequence: number): void {
  if (checkpointSequence > headSequence) {
    throw new RangeError("checkpoint sequence is ahead of the buffer head");
  }
}

export function encodeGeneration(generation: string): Uint8Array {
  return frameWriter(MESSAGE_GENERATION).string(generation).bytes();
}

export function decodeGeneration(frame: Uint8Array): string {
  const reader = new FrameReader(frame, MESSAGE_GENERATION);
  const generation = reader.string();
  reader.end();
  return generation;
}

export function encodeCommitted(updateId: string): Uint8Array {
  return frameWriter(MESSAGE_COMMITTED).string(updateId).bytes();
}

export function decodeCommitted(frame: Uint8Array): string {
  const reader = new FrameReader(frame, MESSAGE_COMMITTED);
  const updateId = reader.string();
  reader.end();
  return updateId;
}

export function encodeAcceptedReceipt(receipt: AcceptedReceipt): Uint8Array {
  checkAcceptedSequence(receipt.acceptedSequence);
  return frameWriter(MESSAGE_ACCEPTED_RECEIPT)
    .string(receipt.updateId)
    .string(receipt.generation)
    .string(receipt.epoch)
    .integer(receipt.acceptedSequence)
    .bytes();
}

export function decodeAcceptedReceipt(frame: Uint8Array): AcceptedReceipt {
  const reader = new FrameReader(frame, MESSAGE_ACCEPTED_RECEIPT);
  const receipt = {
    updateId: reader.string(),
    generation: reader.string(),
    epoch: reader.string(),
    acceptedSequence: reader.integer(),
  };
  reader.end();
  checkAcceptedSequence(receipt.acceptedSequence);
  return receipt;
}

export function encodeCheckpointProgress(progress: CheckpointProgress): Uint8Array {
  return frameWriter(MESSAGE_CHECKPOINT_PROGRESS)
    .string(progress.generation)
    .string(progress.epoch)
    .integer(progress.coveredSequence)
    .integer(progress.checkpointRevision)
    .bytes();
}

export function decodeCheckpointProgress(frame: Uint8Array): CheckpointProgress {
  const reader = new FrameReader(frame, MESSAGE_CHECKPOINT_PROGRESS);
  const progress = {
    generation: reader.string(),
    epoch: reader.string(),
    coveredSequence: reader.integer(),
    checkpointRevision: reader.integer(),
  };
  reader.end();
  return progress;
}

export function encodeSessionState(state: SessionState): Uint8Array {
  checkWatermark(state.headSequence, state.checkpointSequence);
  return frameWriter(MESSAGE_SESSION_STATE)
    .string(state.generation)
    .string(state.epoch)
    .integer(state.headSequence)
    .integer(state.checkpointSequence)
    .integer(state.checkpointRevision)
    .bytes();
}

export function decodeSessionState(frame: Uint8Array): SessionState {
  const reader = new FrameReader(frame, MESSAGE_SESSION_STATE);
  const state = {
    generation: reader.string(),
    epoch: reader.string(),
    headSequence: reader.integer(),
    checkpointSequence: reader.integer(),
    checkpointRevision: reader.integer(),
  };
  reader.end();
  checkWatermark(state.headSequence, state.checkpointSequence);
  return state;
}
