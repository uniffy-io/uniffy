import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

export const SEED_CONFLICT_REASON = "seed_conflict";
// The server refused a write it may accept later; the client keeps it and retries.
export const UNAVAILABLE_REASON = "unavailable";
// The server already holds different bytes under this update id.
export const UPDATE_CONFLICT_REASON = "update conflict";

export const CANONICAL_SUBPROTOCOL = "uniffy.realtime.v2";

// Window events the auth layer fires; transport and the pending-doc drain reconnect on them.
export const AUTH_REFRESHED_EVENT = "uniffy:auth:refreshed";
export const AUTH_REVOKED_EVENT = "uniffy:auth:revoked";

export const WS_CLOSE_NORMAL = 1000;
export const WS_CLOSE_MESSAGE_TOO_BIG = 1009;
export const WS_CLOSE_UNAUTHENTICATED = 4401;
export const WS_CLOSE_FORBIDDEN = 4403;
// The server bounds a socket by the lifetime of the token that opened it.
// Refresh, then reconnect - this is not a revocation.
export const WS_CLOSE_REAUTH_REQUIRED = 4409;
export const WS_CLOSE_TOKEN_REVOKED = 4410;
// The server speaks a protocol this bundle does not; only a reload can fix that.
export const WS_CLOSE_UPGRADE_REQUIRED = 4426;

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "offline"
  | "permission_lost"
  | "access_lost"
  | "update_rejected"
  | "token_revoked"
  | "upgrade_required";

export function statusFromCloseCode(code: number): RealtimeStatus | null {
  switch (code) {
    case WS_CLOSE_FORBIDDEN:
      return "permission_lost";
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

export const MAX_WIRE_STRING_BYTES = 128;
export const MAX_WIRE_INTEGER = Number.MAX_SAFE_INTEGER;

/** The server buffered the update; only checkpoint progress proves PostgreSQL holds it. */
export interface AcceptedReceipt {
  updateId: string;
  generation: string;
  epoch: string;
  acceptedSequence: number;
}

/** PostgreSQL committed every accepted update of this epoch up to `coveredSequence`. */
export interface CheckpointProgress {
  generation: string;
  epoch: string;
  coveredSequence: number;
  checkpointRevision: number;
}

/** Buffer head and checkpoint watermark the client reconciles its receipts against. */
export interface SessionState {
  generation: string;
  epoch: string;
  headSequence: number;
  checkpointSequence: number;
  checkpointRevision: number;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function writeString(encoder: encoding.Encoder, value: string): void {
  const bytes = utf8Encoder.encode(value);
  if (bytes.length > MAX_WIRE_STRING_BYTES) {
    throw new Error(`wire string exceeds ${MAX_WIRE_STRING_BYTES} bytes`);
  }
  encoding.writeVarUint8Array(encoder, bytes);
}

function writeInteger(encoder: encoding.Encoder, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`wire integer ${value} outside 0..${MAX_WIRE_INTEGER}`);
  }
  encoding.writeVarUint(encoder, value);
}

function checkAcceptedSequence(sequence: number): void {
  // Zero means "nothing covered" in progress and session state, so no update can hold it.
  if (sequence < 1) throw new Error("accepted sequence starts at 1");
}

function checkWatermark(headSequence: number, checkpointSequence: number): void {
  if (checkpointSequence > headSequence) {
    throw new Error("checkpoint sequence is ahead of buffer head");
  }
}

function startMessage(messageType: number): encoding.Encoder {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageType);
  return encoder;
}

/** Reads one message body; a wrong type, truncation, out-of-range value or trailing bytes throw. */
class FrameReader {
  private readonly decoder: decoding.Decoder;

  constructor(frame: Uint8Array, messageType: number) {
    this.decoder = decoding.createDecoder(frame);
    const kind = this.integer();
    if (kind !== messageType) {
      throw new Error(`expected message type ${messageType}, got ${kind}`);
    }
  }

  integer(): number {
    const value = decoding.readVarUint(this.decoder);
    if (value > MAX_WIRE_INTEGER) throw new Error(`wire integer exceeds ${MAX_WIRE_INTEGER}`);
    return value;
  }

  string(): string {
    const length = this.integer();
    if (length > MAX_WIRE_STRING_BYTES) {
      throw new Error(`wire string exceeds ${MAX_WIRE_STRING_BYTES} bytes`);
    }
    if (this.decoder.pos + length > this.decoder.arr.length) {
      throw new Error("wire string runs past the frame");
    }
    return utf8Decoder.decode(decoding.readUint8Array(this.decoder, length));
  }

  end(): void {
    if (decoding.hasContent(this.decoder)) throw new Error("trailing bytes after message");
  }
}

export function encodeGeneration(generation: string): Uint8Array {
  const encoder = startMessage(MESSAGE_GENERATION);
  writeString(encoder, generation);
  return encoding.toUint8Array(encoder);
}

export function decodeGeneration(frame: Uint8Array): string {
  const reader = new FrameReader(frame, MESSAGE_GENERATION);
  const generation = reader.string();
  reader.end();
  return generation;
}

export function encodeCommitted(updateId: string): Uint8Array {
  const encoder = startMessage(MESSAGE_COMMITTED);
  writeString(encoder, updateId);
  return encoding.toUint8Array(encoder);
}

export function decodeCommitted(frame: Uint8Array): string {
  const reader = new FrameReader(frame, MESSAGE_COMMITTED);
  const updateId = reader.string();
  reader.end();
  return updateId;
}

export function encodeAcceptedReceipt(receipt: AcceptedReceipt): Uint8Array {
  checkAcceptedSequence(receipt.acceptedSequence);
  const encoder = startMessage(MESSAGE_ACCEPTED_RECEIPT);
  writeString(encoder, receipt.updateId);
  writeString(encoder, receipt.generation);
  writeString(encoder, receipt.epoch);
  writeInteger(encoder, receipt.acceptedSequence);
  return encoding.toUint8Array(encoder);
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
  const encoder = startMessage(MESSAGE_CHECKPOINT_PROGRESS);
  writeString(encoder, progress.generation);
  writeString(encoder, progress.epoch);
  writeInteger(encoder, progress.coveredSequence);
  writeInteger(encoder, progress.checkpointRevision);
  return encoding.toUint8Array(encoder);
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
  const encoder = startMessage(MESSAGE_SESSION_STATE);
  writeString(encoder, state.generation);
  writeString(encoder, state.epoch);
  writeInteger(encoder, state.headSequence);
  writeInteger(encoder, state.checkpointSequence);
  writeInteger(encoder, state.checkpointRevision);
  return encoding.toUint8Array(encoder);
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
