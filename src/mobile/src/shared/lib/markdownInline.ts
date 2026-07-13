// Inline markdown tokenizer shared by the note editor's live-styled input and its
// sticky formatting toggles. It keeps every character (markers included) so the
// segment offsets line up 1:1 with the TextInput's value and caret positions -
// hiding markers would desync the native caret on Android.

export type InlineKind =
  | "plain"
  | "marker"
  | "bold"
  | "italic"
  | "bolditalic"
  | "strike"
  | "highlight"
  | "code";

export type InlineFormat = "bold" | "italic" | "strike" | "highlight" | "code";

export type InlineSeg = {
  start: number;
  end: number;
  kind: InlineKind;
  text: string;
  // Content segments only: the length of one wrapper marker and the offset just
  // past the closing marker, so the caller can drop the caret outside the span.
  markerLen?: number;
  closeEnd?: number;
};

export type InlineActive = {
  flags: Record<InlineFormat, boolean>;
  ends: Partial<Record<InlineFormat, number>>;
  // Present when the active span has no content yet (e.g. a freshly inserted
  // "**|**"), giving the marker range so toggling off can remove it cleanly.
  emptyRange: Partial<Record<InlineFormat, { open: number; close: number }>>;
};

// Wrapper pairs, longest markers first so ** wins over *. Content is *? (may be
// empty) so a just-inserted, still-empty pair is recognised as an active span.
// The \s guards keep "a * b" from italicising stray spaces while still matching
// the empty case (adjacent markers are asterisks, not spaces).
const INLINE_RE =
  /(`[^`\n]*`)|(\*\*\*(?!\s)[^\n]*?(?<!\s)\*\*\*)|(\*\*(?!\s)[^\n]*?(?<!\s)\*\*)|(~~(?!\s)[^\n]*?(?<!\s)~~)|(==(?!\s)[^\n]*?(?<!\s)==)|(\*(?!\s)[^*\n]*?(?<!\s)\*)/g;

const CONTENT_KINDS: ReadonlySet<InlineKind> = new Set([
  "bold",
  "italic",
  "bolditalic",
  "strike",
  "highlight",
  "code",
]);

export function isContentKind(kind: InlineKind): boolean {
  return CONTENT_KINDS.has(kind);
}

// Partition a single line into segments covering every character: plain runs,
// dim markers, and styled content. Markers stay in their own segments so the
// input can dim them without dropping any characters.
export function tokenizeLine(line: string): InlineSeg[] {
  const segs: InlineSeg[] = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(line)) !== null) {
    if (m[0].length === 0) {
      INLINE_RE.lastIndex++;
      continue;
    }
    if (m.index > last) {
      segs.push({ start: last, end: m.index, kind: "plain", text: line.slice(last, m.index) });
    }
    const start = m.index;
    const end = start + m[0].length;
    let markerLen: number;
    let kind: InlineKind;
    if (m[1] !== undefined) {
      markerLen = 1;
      kind = "code";
    } else if (m[2] !== undefined) {
      markerLen = 3;
      kind = "bolditalic";
    } else if (m[3] !== undefined) {
      markerLen = 2;
      kind = "bold";
    } else if (m[4] !== undefined) {
      markerLen = 2;
      kind = "strike";
    } else if (m[5] !== undefined) {
      markerLen = 2;
      kind = "highlight";
    } else {
      markerLen = 1;
      kind = "italic";
    }
    const cStart = start + markerLen;
    const cEnd = end - markerLen;
    segs.push({ start, end: cStart, kind: "marker", text: line.slice(start, cStart) });
    segs.push({
      start: cStart,
      end: cEnd,
      kind,
      text: line.slice(cStart, cEnd),
      markerLen,
      closeEnd: end,
    });
    segs.push({ start: cEnd, end, kind: "marker", text: line.slice(cEnd, end) });
    last = end;
  }
  if (last < line.length) {
    segs.push({ start: last, end: line.length, kind: "plain", text: line.slice(last) });
  }
  return segs;
}

// Which inline formats enclose the caret, so the toolbar can light the matching
// toggles and jump the caret out when the user presses an already-active one.
export function inlineActiveAt(body: string, caret: number): InlineActive {
  const flags: Record<InlineFormat, boolean> = {
    bold: false,
    italic: false,
    strike: false,
    highlight: false,
    code: false,
  };
  const ends: Partial<Record<InlineFormat, number>> = {};
  const emptyRange: Partial<Record<InlineFormat, { open: number; close: number }>> = {};
  if (caret < 0) return { flags, ends, emptyRange };

  const lineStart = body.lastIndexOf("\n", caret - 1) + 1;
  let lineEnd = body.indexOf("\n", caret);
  if (lineEnd === -1) lineEnd = body.length;
  const off = caret - lineStart;

  for (const s of tokenizeLine(body.slice(lineStart, lineEnd))) {
    if (!isContentKind(s.kind)) continue;
    if (off < s.start || off > s.end) continue;
    const keys: InlineFormat[] =
      s.kind === "bolditalic" ? ["bold", "italic"] : [s.kind as InlineFormat];
    const markerLen = s.markerLen ?? 0;
    const closeEnd = s.closeEnd ?? s.end;
    for (const k of keys) {
      flags[k] = true;
      ends[k] = lineStart + closeEnd;
      if (s.text.length === 0) {
        emptyRange[k] = { open: lineStart + s.start - markerLen, close: lineStart + closeEnd };
      }
    }
  }
  return { flags, ends, emptyRange };
}
