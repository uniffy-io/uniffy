import { expect, it } from "vitest";
import { diffStrings } from "@features/notes/realtime/textDiff";
import {
  applyDelta,
  composeDeltas,
  deltaFromTextDelta,
  fineDiff,
  refineDelta,
  transformDelta,
  transformIndex,
  type Delta,
} from "@features/notes/realtime/textDelta";

// Seeded generator so a failing case replays byte for byte.
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const ALPHABET = "ab \n_*-";

function randomText(rand: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return out;
}

function randomDelta(rand: () => number, text: string): Delta {
  const ops: Delta = [];
  let pos = 0;
  while (pos < text.length) {
    const roll = rand();
    const span = Math.min(1 + Math.floor(rand() * 4), text.length - pos);
    if (roll < 0.5) {
      ops.push({ retain: span });
      pos += span;
    } else if (roll < 0.8) {
      ops.push({ delete: span });
      pos += span;
    } else {
      ops.push({ insert: randomText(rand, span) });
    }
  }
  if (rand() < 0.3) ops.push({ insert: randomText(rand, 2) });
  return ops;
}

it("maps an index through inserts and deletes", () => {
  const delta: Delta = [{ retain: 2 }, { insert: "XX" }, { retain: 3 }, { delete: 2 }];
  expect(transformIndex(1, delta, true)).toBe(1);
  expect(transformIndex(2, delta, true)).toBe(2);
  expect(transformIndex(2, delta, false)).toBe(4);
  expect(transformIndex(3, delta, true)).toBe(5);
  expect(transformIndex(6, delta, true)).toBe(7);
  expect(transformIndex(8, delta, true)).toBe(8);
});

it("keeps the characters around escaped spans as retains", () => {
  const delta = fineDiff("a_b and c*d", "a\\_b and c\\*d");
  expect(delta).toEqual([{ retain: 1 }, { insert: "\\" }, { retain: 8 }, { insert: "\\" }]);
  expect(transformIndex(4, delta, true)).toBe(5);
  expect(transformIndex(9, delta, true)).toBe(10);
  expect(transformIndex(11, delta, true)).toBe(13);
});

it("limits a bullet rewrite to the markers and the trailing newline", () => {
  const before = "* item one\n\nsome text here\n\n* item two";
  const after = "- item one\n\nsome text here\n\n- item two\n";
  const delta = fineDiff(before, after);
  expect(applyDelta(before, delta)).toBe(after);
  expect(delta).toEqual([
    { delete: 1 },
    { insert: "-" },
    { retain: 27 },
    { delete: 1 },
    { insert: "-" },
    { retain: 9 },
    { insert: "\n" },
  ]);
  expect(transformIndex(19, delta, true)).toBe(19);
  expect(transformIndex(before.length, delta, true)).toBe(after.length - 1);
  expect(transformIndex(before.length, delta, false)).toBe(after.length);
});

it("refines a coarse replace against the text it replaced", () => {
  const before = "a_b and c*d";
  const after = "a\\_b and c\\*d";
  const coarse = deltaFromTextDelta(diffStrings(before, after)!);
  expect(coarse).toEqual([{ retain: 1 }, { delete: 8 }, { insert: "\\_b and c\\" }]);
  expect(refineDelta(coarse, before)).toEqual(fineDiff(before, after));
  expect(refineDelta([{ insert: after }, { delete: before.length }], before)).toEqual(
    fineDiff(before, after),
  );
});

it("leaves pure inserts and pure deletes alone when refining", () => {
  expect(refineDelta([{ retain: 2 }, { insert: "xy" }], "abcd")).toEqual([
    { retain: 2 },
    { insert: "xy" },
  ]);
  expect(refineDelta([{ delete: 2 }, { retain: 2 }], "abcd")).toEqual([{ delete: 2 }]);
});

it("reproduces the target text for random pairs, long documents and exhausted budgets", () => {
  const rand = lcg(7);
  for (let i = 0; i < 200; i++) {
    const before = randomText(rand, Math.floor(rand() * 40));
    const after = randomText(rand, Math.floor(rand() * 40));
    expect(applyDelta(before, fineDiff(before, after))).toBe(after);
  }
  const lines = Array.from({ length: 400 }, (_, i) => `line ${i} with some_words *here*`);
  const before = lines.join("\n");
  const after = lines.map((line, i) => (i % 7 === 0 ? line.replace("_", "\\_") : line)).join("\n");
  const delta = fineDiff(before, after);
  expect(applyDelta(before, delta)).toBe(after);
  expect(delta.filter((op) => "retain" in op).length).toBeGreaterThan(50);
  const noisyBefore = randomText(rand, 3000);
  const noisyAfter = randomText(rand, 3000);
  expect(applyDelta(noisyBefore, fineDiff(noisyBefore, noisyAfter))).toBe(noisyAfter);
});

it("composes two deltas into one with the same effect", () => {
  const rand = lcg(11);
  for (let i = 0; i < 300; i++) {
    const start = randomText(rand, Math.floor(rand() * 20));
    const first = randomDelta(rand, start);
    const middle = applyDelta(start, first);
    const second = randomDelta(rand, middle);
    expect(applyDelta(start, composeDeltas(first, second))).toBe(applyDelta(middle, second));
  }
});

it("transforms concurrent deltas so both orders converge", () => {
  const rand = lcg(13);
  for (let i = 0; i < 300; i++) {
    const start = randomText(rand, Math.floor(rand() * 20));
    const a = randomDelta(rand, start);
    const b = randomDelta(rand, start);
    const viaA = applyDelta(applyDelta(start, a), transformDelta(b, a, true));
    const viaB = applyDelta(applyDelta(start, b), transformDelta(a, b, false));
    expect(viaA).toBe(viaB);
  }
});

it("orders same-index inserts by the priority flag", () => {
  const local: Delta = [{ retain: 2 }, { insert: "L" }];
  const remote: Delta = [{ retain: 2 }, { insert: "R" }];
  expect(applyDelta(applyDelta("abcd", remote), transformDelta(local, remote, false))).toBe(
    "abLRcd",
  );
  expect(applyDelta(applyDelta("abcd", local), transformDelta(remote, local, true))).toBe("abLRcd");
});
