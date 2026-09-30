export interface TextDelta {
  index: number;
  deleteCount: number;
  insert: string;
}

/**
 * Minimal common-prefix/suffix delta so a small edit produces a small Yjs
 * update instead of a whole-document delete + insert. Returns null when the
 * strings are equal.
 */
export function diffStrings(prev: string, next: string): TextDelta | null {
  if (prev === next) return null;
  let prefix = 0;
  const minLen = Math.min(prev.length, next.length);
  while (prefix < minLen && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (
    suffix < prev.length - prefix &&
    suffix < next.length - prefix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }
  return {
    index: prefix,
    deleteCount: prev.length - prefix - suffix,
    insert: next.slice(prefix, next.length - suffix),
  };
}
