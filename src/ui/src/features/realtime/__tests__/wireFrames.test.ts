import { describe, expect, it } from "vitest";
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

describe("realtime wire corpus", () => {
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
