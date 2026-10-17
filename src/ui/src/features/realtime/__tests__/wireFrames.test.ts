import * as decoding from "lib0/decoding";
import { describe, expect, it } from "vitest";
import { UNAVAILABLE_REASON, UPDATE_CONFLICT_REASON } from "@/features/realtime/protocol";
import {
  decodeCorpusFrame,
  encodeCorpusFrame,
  fromHex,
  toHex,
  wireCorpus,
  type CorpusFrame,
} from "@/features/realtime/__tests__/wireCorpus";

const valid = wireCorpus.cases.filter(
  (item): item is typeof item & CorpusFrame => item.error === undefined,
);
const sequenceFrames = wireCorpus.sequences.flatMap((sequence) =>
  sequence.steps.flatMap((step, index) =>
    "frame" in step ? [{ name: `${sequence.name}[${index}]`, ...step.frame }] : [],
  ),
);
const frames = [...valid, ...sequenceFrames];
const malformed = wireCorpus.cases.filter((item) => item.error !== undefined);
// Out-of-contract values a naive encoder would still serialize; the corpus keeps their bytes.
const unencodable = malformed.filter(
  (item): item is typeof item & CorpusFrame => item.fields !== undefined,
);

const MESSAGE_AUTH = 2;

/** Reads a document denial the way the multiplexer does. */
function readDenial(name: string): { scope: number; reason: string } {
  const denial = wireCorpus.denials.find((item) => item.name === name);
  if (!denial) throw new Error(`corpus has no denial ${name}`);
  const decoder = decoding.createDecoder(fromHex(denial.hex));
  expect(decoding.readVarUint(decoder)).toBe(MESSAGE_AUTH);
  const scope = decoding.readVarUint(decoder);
  const reason = decoding.readVarString(decoder);
  expect(decoding.hasContent(decoder)).toBe(false);
  return { scope, reason };
}

describe("realtime wire corpus", () => {
  it.each([
    ["denial_unavailable", UNAVAILABLE_REASON],
    ["denial_update_conflict", UPDATE_CONFLICT_REASON],
  ])("reads %s as the exact reason the client acts on", (name, reason) => {
    expect(readDenial(name)).toEqual({ scope: 0, reason });
  });

  it.each(frames.map((frame) => [frame.name, frame] as const))(
    "encodes %s to the corpus bytes",
    (_, frame) => {
      expect(toHex(encodeCorpusFrame(frame.type, frame.fields))).toBe(frame.hex);
    },
  );

  it.each(frames.map((frame) => [frame.name, frame] as const))(
    "decodes %s to the corpus fields",
    (_, frame) => {
      expect(decodeCorpusFrame(frame.type, fromHex(frame.hex))).toEqual(frame.fields);
    },
  );

  it.each(malformed.map((item) => [item.name, item] as const))("rejects %s", (_, item) => {
    expect(() => decodeCorpusFrame(item.type, fromHex(item.hex))).toThrow();
  });

  it.each(unencodable.map((item) => [item.name, item] as const))(
    "refuses to encode %s",
    (_, item) => {
      expect(() => encodeCorpusFrame(item.type, item.fields)).toThrow();
    },
  );
});
