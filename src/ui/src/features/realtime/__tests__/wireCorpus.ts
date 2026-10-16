import { readFileSync } from "node:fs";
import type { Coverage } from "@/features/realtime/updateCoverage";
import {
  MESSAGE_ACCEPTED_RECEIPT,
  MESSAGE_CHECKPOINT_PROGRESS,
  MESSAGE_COMMITTED,
  MESSAGE_GENERATION,
  MESSAGE_SESSION_STATE,
  decodeAcceptedReceipt,
  decodeCheckpointProgress,
  decodeCommitted,
  decodeGeneration,
  decodeSessionState,
  encodeAcceptedReceipt,
  encodeCheckpointProgress,
  encodeCommitted,
  encodeGeneration,
  encodeSessionState,
} from "@/features/realtime/protocol";

type CorpusFields = Record<string, string | number>;

export interface CorpusFrame {
  type: number;
  fields: CorpusFields;
  hex: string;
}

export interface CorpusCase {
  name: string;
  type: number;
  hex: string;
  fields?: CorpusFields;
  error?: string;
}

export type CorpusStep = { frame: CorpusFrame } | { local: string };

export interface CorpusSequence {
  name: string;
  description: string;
  steps: CorpusStep[];
  coverage: Record<string, Coverage>;
}

/** The realtime frames the backend, web and mobile codecs are all held to. */
export const wireCorpus = JSON.parse(
  readFileSync(
    new URL("../../../../../proto/tests/fixtures/realtime_wire_frames.json", import.meta.url),
    "utf8",
  ),
) as { cases: CorpusCase[]; sequences: CorpusSequence[] };

export function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const str = (fields: CorpusFields, key: string) => fields[key] as string;
const int = (fields: CorpusFields, key: string) => fields[key] as number;

// Corpus fields use the wire names; the codecs use camelCase.
const codecs: Record<
  number,
  { encode: (fields: CorpusFields) => Uint8Array; decode: (frame: Uint8Array) => CorpusFields }
> = {
  [MESSAGE_GENERATION]: {
    encode: (fields) => encodeGeneration(str(fields, "generation")),
    decode: (frame) => ({ generation: decodeGeneration(frame) }),
  },
  [MESSAGE_COMMITTED]: {
    encode: (fields) => encodeCommitted(str(fields, "update_id")),
    decode: (frame) => ({ update_id: decodeCommitted(frame) }),
  },
  [MESSAGE_ACCEPTED_RECEIPT]: {
    encode: (fields) =>
      encodeAcceptedReceipt({
        updateId: str(fields, "update_id"),
        generation: str(fields, "generation"),
        epoch: str(fields, "epoch"),
        acceptedSequence: int(fields, "accepted_sequence"),
      }),
    decode: (frame) => {
      const receipt = decodeAcceptedReceipt(frame);
      return {
        update_id: receipt.updateId,
        generation: receipt.generation,
        epoch: receipt.epoch,
        accepted_sequence: receipt.acceptedSequence,
      };
    },
  },
  [MESSAGE_CHECKPOINT_PROGRESS]: {
    encode: (fields) =>
      encodeCheckpointProgress({
        generation: str(fields, "generation"),
        epoch: str(fields, "epoch"),
        coveredSequence: int(fields, "covered_sequence"),
        checkpointRevision: int(fields, "checkpoint_revision"),
      }),
    decode: (frame) => {
      const progress = decodeCheckpointProgress(frame);
      return {
        generation: progress.generation,
        epoch: progress.epoch,
        covered_sequence: progress.coveredSequence,
        checkpoint_revision: progress.checkpointRevision,
      };
    },
  },
  [MESSAGE_SESSION_STATE]: {
    encode: (fields) =>
      encodeSessionState({
        generation: str(fields, "generation"),
        epoch: str(fields, "epoch"),
        headSequence: int(fields, "head_sequence"),
        checkpointSequence: int(fields, "checkpoint_sequence"),
        checkpointRevision: int(fields, "checkpoint_revision"),
      }),
    decode: (frame) => {
      const state = decodeSessionState(frame);
      return {
        generation: state.generation,
        epoch: state.epoch,
        head_sequence: state.headSequence,
        checkpoint_sequence: state.checkpointSequence,
        checkpoint_revision: state.checkpointRevision,
      };
    },
  },
};

export function encodeCorpusFrame(type: number, fields: CorpusFields): Uint8Array {
  return codecs[type].encode(fields);
}

export function decodeCorpusFrame(type: number, frame: Uint8Array): CorpusFields {
  return codecs[type].decode(frame);
}
