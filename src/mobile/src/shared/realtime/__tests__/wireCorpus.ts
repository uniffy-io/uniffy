import { readFileSync } from "node:fs";
import type { Coverage } from "@shared/realtime/updateCoverage";

type Fields = Record<string, string | number>;

export interface CorpusFrame {
  name: string;
  type: number;
  fields?: Fields;
  hex: string;
  error?: string;
}

export interface CorpusSequence {
  name: string;
  steps: ({ frame: CorpusFrame } | { local: string })[];
  coverage: Record<string, Coverage>;
}

/** The frames and coverage sequences the backend and web codecs are held to as well. */
export const wireCorpus: { cases: CorpusFrame[]; sequences: CorpusSequence[] } = JSON.parse(
  readFileSync(
    new URL("../../../../../proto/tests/fixtures/realtime_wire_frames.json", import.meta.url),
    "utf8",
  ),
);

export function fromHex(hex: string): Uint8Array {
  return new Uint8Array((hex.match(/../g) ?? []).map((byte) => parseInt(byte, 16)));
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Corpus fields are snake_case; client messages are camelCase. */
export function camelFields(fields: Fields = {}): Fields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
}
