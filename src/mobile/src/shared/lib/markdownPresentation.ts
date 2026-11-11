export function normalizeMarkdownListMarker(line: string): string {
  return line.replace(/^([+*]) /, "- ");
}

// Call only outside code spans and fenced blocks.
export function markdownDisplayText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<!--uniffy:image-ratio=\d+(?:\.\d+)?-->/g, "")
    .replace(/&#(?:x20|32);/gi, " ");
}

/** Cells of a `| a | b |` row; an escaped `\|` stays in its cell, so `[[[label\|urn]]]` survives. */
export function parseTableRow(line: string): string[] {
  return line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}
