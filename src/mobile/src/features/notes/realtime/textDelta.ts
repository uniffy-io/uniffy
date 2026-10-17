import { diffStrings, type TextDelta } from "@features/notes/realtime/textDiff";

export type DeltaOp = { retain: number } | { insert: string } | { delete: number };
/** Quill-style text delta: retain, insert and delete ops over UTF-16 code units. */
export type Delta = DeltaOp[];

// Myers runs in O((N + M) * D); past this many edits a region is one replace.
const MAX_EDITS = 512;

function opLength(op: DeltaOp): number {
  if ("retain" in op) return op.retain;
  if ("delete" in op) return op.delete;
  return op.insert.length;
}

function push(out: Delta, op: DeltaOp): void {
  if (opLength(op) === 0) return;
  const last = out[out.length - 1];
  if (last) {
    if ("retain" in op && "retain" in last) {
      out[out.length - 1] = { retain: last.retain + op.retain };
      return;
    }
    if ("delete" in op && "delete" in last) {
      out[out.length - 1] = { delete: last.delete + op.delete };
      return;
    }
    if ("insert" in op && "insert" in last) {
      out[out.length - 1] = { insert: last.insert + op.insert };
      return;
    }
  }
  out.push(op);
}

function chop(out: Delta): Delta {
  const last = out[out.length - 1];
  if (last && "retain" in last) out.pop();
  return out;
}

class OpCursor {
  private index = 0;
  private offset = 0;

  constructor(private readonly ops: Delta) {}

  hasNext(): boolean {
    return this.index < this.ops.length;
  }

  peekLength(): number {
    const op = this.ops[this.index];
    return op ? opLength(op) - this.offset : Infinity;
  }

  peekType(): "retain" | "insert" | "delete" {
    const op = this.ops[this.index];
    if (!op || "retain" in op) return "retain";
    return "insert" in op ? "insert" : "delete";
  }

  next(length = Infinity): DeltaOp {
    const op = this.ops[this.index];
    if (!op) return { retain: length };
    const start = this.offset;
    const take = Math.min(length, opLength(op) - start);
    if (start + take >= opLength(op)) {
      this.index += 1;
      this.offset = 0;
    } else {
      this.offset = start + take;
    }
    if ("retain" in op) return { retain: take };
    if ("delete" in op) return { delete: take };
    return { insert: op.insert.slice(start, start + take) };
  }
}

export function applyDelta(text: string, delta: Delta): string {
  let out = "";
  let pos = 0;
  for (const op of delta) {
    if ("retain" in op) {
      out += text.slice(pos, pos + op.retain);
      pos += op.retain;
    } else if ("insert" in op) {
      out += op.insert;
    } else {
      pos += op.delete;
    }
  }
  return out + text.slice(pos);
}

export function deltaFromTextDelta(delta: TextDelta): Delta {
  const out: Delta = [];
  push(out, { retain: delta.index });
  push(out, { delete: delta.deleteCount });
  push(out, { insert: delta.insert });
  return out;
}

/** Plain-string view of a `Y.Text` event delta; embeds carry no text and are skipped. */
export function deltaFromYjs(
  ops: readonly { insert?: unknown; retain?: number; delete?: number }[],
): Delta {
  const out: Delta = [];
  for (const op of ops) {
    if (typeof op.retain === "number") push(out, { retain: op.retain });
    else if (typeof op.delete === "number") push(out, { delete: op.delete });
    else if (typeof op.insert === "string") push(out, { insert: op.insert });
  }
  return chop(out);
}

/** One delta equal to applying `first` then `second`. */
export function composeDeltas(first: Delta, second: Delta): Delta {
  const a = new OpCursor(first);
  const b = new OpCursor(second);
  const out: Delta = [];
  while (a.hasNext() || b.hasNext()) {
    if (b.peekType() === "insert") {
      push(out, b.next());
    } else if (a.peekType() === "delete") {
      push(out, a.next());
    } else {
      const length = Math.min(a.peekLength(), b.peekLength());
      const opA = a.next(length);
      const opB = b.next(length);
      if ("retain" in opB) push(out, opA);
      else if ("delete" in opB && "retain" in opA) push(out, opB);
    }
  }
  return chop(out);
}

/**
 * Rebase `delta` onto the text produced by `against`, both starting from the
 * same text. `againstFirst` orders inserts that land on the same index.
 */
export function transformDelta(delta: Delta, against: Delta, againstFirst: boolean): Delta {
  const a = new OpCursor(against);
  const b = new OpCursor(delta);
  const out: Delta = [];
  while (a.hasNext() || b.hasNext()) {
    if (a.peekType() === "insert" && (againstFirst || b.peekType() !== "insert")) {
      push(out, { retain: opLength(a.next()) });
    } else if (b.peekType() === "insert") {
      push(out, b.next());
    } else {
      const length = Math.min(a.peekLength(), b.peekLength());
      const opA = a.next(length);
      const opB = b.next(length);
      if ("delete" in opA) continue;
      if ("delete" in opB) push(out, opB);
      else push(out, { retain: length });
    }
  }
  return chop(out);
}

/** Map an index through `delta`; `stayBefore` keeps it in front of an insert at that index. */
export function transformIndex(index: number, delta: Delta, stayBefore: boolean): number {
  let offset = 0;
  for (const op of delta) {
    if (offset > index) break;
    if ("delete" in op) {
      index -= Math.min(op.delete, index - offset);
      continue;
    }
    if ("insert" in op && (offset < index || !stayBefore)) index += op.insert.length;
    offset += opLength(op);
  }
  return index;
}

interface EditRun {
  kind: "equal" | "remove" | "add";
  count: number;
}

function addRun(runs: EditRun[], kind: EditRun["kind"], count: number): void {
  const last = runs[runs.length - 1];
  if (last && last.kind === kind) last.count += count;
  else runs.push({ kind, count });
}

function backtrack(
  trace: Int32Array[],
  depth: number,
  n: number,
  m: number,
  offset: number,
): EditRun[] {
  const reversed: EditRun[] = [];
  let x = n;
  let y = m;
  for (let d = depth; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    let equal = 0;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      equal++;
    }
    if (equal > 0) addRun(reversed, "equal", equal);
    addRun(reversed, x === prevX ? "add" : "remove", 1);
    x = prevX;
    y = prevY;
  }
  if (x > 0) addRun(reversed, "equal", x);
  const runs: EditRun[] = [];
  for (let i = reversed.length - 1; i >= 0; i--) addRun(runs, reversed[i].kind, reversed[i].count);
  return runs;
}

// Myers shortest edit script over two sequences; null once the edit budget is spent.
function myers(n: number, m: number, equal: (i: number, j: number) => boolean): EditRun[] | null {
  const max = Math.min(MAX_EDITS, n + m);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
      let x = down ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && equal(x, y)) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, d, n, m, offset);
    }
  }
  return null;
}

function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function replaceOps(removed: string, added: string): Delta {
  const out: Delta = [];
  push(out, { delete: removed.length });
  push(out, { insert: added });
  return out;
}

// Character-level script covering all of `removed`, trailing retain included.
function diffChars(removed: string, added: string): Delta {
  if (removed.length === 0 || added.length === 0) return replaceOps(removed, added);
  const trimmed = diffStrings(removed, added);
  if (!trimmed) return [{ retain: removed.length }];
  const out: Delta = [];
  push(out, { retain: trimmed.index });
  const x = removed.slice(trimmed.index, trimmed.index + trimmed.deleteCount);
  const y = trimmed.insert;
  const runs =
    x.length > 0 && y.length > 0
      ? myers(x.length, y.length, (i, j) => x.charCodeAt(i) === y.charCodeAt(j))
      : null;
  if (!runs) {
    for (const op of replaceOps(x, y)) push(out, op);
  } else {
    let yi = 0;
    for (const run of runs) {
      if (run.kind === "equal") {
        push(out, { retain: run.count });
        yi += run.count;
      } else if (run.kind === "remove") {
        push(out, { delete: run.count });
      } else {
        push(out, { insert: y.slice(yi, yi + run.count) });
        yi += run.count;
      }
    }
  }
  push(out, { retain: removed.length - trimmed.index - trimmed.deleteCount });
  return out;
}

// Line-level script first so a document-wide rewrite only pays character
// diffs inside the lines that changed.
function diffRegion(removed: string, added: string): Delta {
  if (removed.length === 0 || added.length === 0) return replaceOps(removed, added);
  const a = splitLines(removed);
  const b = splitLines(added);
  const runs = a.length + b.length > 2 ? myers(a.length, b.length, (i, j) => a[i] === b[j]) : null;
  if (!runs) return diffChars(removed, added);
  const out: Delta = [];
  let ai = 0;
  let bi = 0;
  let pendingRemoved = "";
  let pendingAdded = "";
  const flushReplace = () => {
    if (pendingRemoved.length > 0 || pendingAdded.length > 0) {
      for (const op of diffChars(pendingRemoved, pendingAdded)) push(out, op);
    }
    pendingRemoved = "";
    pendingAdded = "";
  };
  for (const run of runs) {
    if (run.kind === "equal") {
      flushReplace();
      let length = 0;
      for (let i = 0; i < run.count; i++) length += a[ai + i].length;
      push(out, { retain: length });
      ai += run.count;
      bi += run.count;
    } else if (run.kind === "remove") {
      pendingRemoved += a.slice(ai, ai + run.count).join("");
      ai += run.count;
    } else {
      pendingAdded += b.slice(bi, bi + run.count).join("");
      bi += run.count;
    }
  }
  flushReplace();
  return out;
}

// Full-coverage script: its retains and deletes add up to `before.length`.
function fineDiffOps(before: string, after: string): Delta {
  const trimmed = diffStrings(before, after);
  if (!trimmed) return before.length > 0 ? [{ retain: before.length }] : [];
  const out: Delta = [];
  push(out, { retain: trimmed.index });
  const removed = before.slice(trimmed.index, trimmed.index + trimmed.deleteCount);
  for (const op of diffRegion(removed, trimmed.insert)) push(out, op);
  push(out, { retain: before.length - trimmed.index - trimmed.deleteCount });
  return out;
}

/**
 * Minimal delta from `before` to `after` that keeps unchanged runs as
 * retains, so indices inside them survive a rewrite that touches the text
 * on both sides.
 */
export function fineDiff(before: string, after: string): Delta {
  return chop(fineDiffOps(before, after));
}

/**
 * Split every delete-plus-insert pair of `delta` into a fine diff against the
 * text it replaced. Peers that rewrite a span as one replace still move only
 * the characters that changed.
 */
export function refineDelta(delta: Delta, before: string): Delta {
  const out: Delta = [];
  let pos = 0;
  let i = 0;
  while (i < delta.length) {
    const op = delta[i];
    if ("retain" in op) {
      push(out, op);
      pos += op.retain;
      i++;
      continue;
    }
    let deleted = 0;
    let inserted = "";
    while (i < delta.length && !("retain" in delta[i])) {
      const run = delta[i];
      if ("insert" in run) inserted += run.insert;
      else if ("delete" in run) deleted += run.delete;
      i++;
    }
    if (deleted > 0 && inserted.length > 0) {
      for (const fine of fineDiffOps(before.slice(pos, pos + deleted), inserted)) push(out, fine);
    } else {
      push(out, { delete: deleted });
      push(out, { insert: inserted });
    }
    pos += deleted;
  }
  return chop(out);
}
