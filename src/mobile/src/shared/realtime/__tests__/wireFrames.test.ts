import { expect, it } from "vitest";
import {
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
  type AcceptedReceipt,
  type CheckpointProgress,
  type SessionState,
} from "@shared/realtime/protocol";
import {
  camelFields,
  fromHex,
  toHex,
  wireCorpus,
  type CorpusFrame,
} from "@shared/realtime/__tests__/wireCorpus";

type Fields = ReturnType<typeof camelFields>;

const codecs: Record<
  number,
  { encode: (fields: Fields) => Uint8Array; decode: (frame: Uint8Array) => unknown }
> = {
  5: {
    encode: (fields) => encodeGeneration(fields.generation as string),
    decode: (frame) => ({ generation: decodeGeneration(frame) }),
  },
  7: {
    encode: (fields) => encodeCommitted(fields.updateId as string),
    decode: (frame) => ({ updateId: decodeCommitted(frame) }),
  },
  11: {
    encode: (fields) => encodeAcceptedReceipt(fields as unknown as AcceptedReceipt),
    decode: decodeAcceptedReceipt,
  },
  12: {
    encode: (fields) => encodeCheckpointProgress(fields as unknown as CheckpointProgress),
    decode: decodeCheckpointProgress,
  },
  13: {
    encode: (fields) => encodeSessionState(fields as unknown as SessionState),
    decode: decodeSessionState,
  },
};

const wellFormed: CorpusFrame[] = [
  ...wireCorpus.cases.filter((frame) => frame.error === undefined),
  ...wireCorpus.sequences.flatMap((sequence) =>
    sequence.steps.flatMap((step, index) =>
      "frame" in step ? [{ ...step.frame, name: `${sequence.name}[${index}]` }] : [],
    ),
  ),
];
const malformed = wireCorpus.cases.filter((frame) => frame.error !== undefined);

it("reads every corpus case", () => {
  expect(wireCorpus.cases).toHaveLength(33);
  expect(malformed.length).toBeGreaterThan(0);
});

it.each(wellFormed)("$name encodes and decodes byte for byte", (frame) => {
  const codec = codecs[frame.type];
  expect(toHex(codec.encode(camelFields(frame.fields)))).toBe(frame.hex);
  expect(codec.decode(fromHex(frame.hex))).toEqual(camelFields(frame.fields));
});

it.each(malformed)("$name is rejected", (frame) => {
  const codec = codecs[frame.type];
  expect(() => codec.decode(fromHex(frame.hex))).toThrow();
  if (frame.fields) expect(() => codec.encode(camelFields(frame.fields))).toThrow();
});
