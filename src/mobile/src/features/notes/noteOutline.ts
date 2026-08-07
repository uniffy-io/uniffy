export interface Heading {
  level: number;
  text: string;
}

export interface OutgoingMention {
  label: string;
  urn: string;
}

// Must stay in lockstep with MarkdownRenderer's heading detection: the outline
// scrolls by ordinal, so a heading counted here but skipped there (or the other
// way round) sends every later jump to the wrong place. Both skip fenced code.
export function parseHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  let inFence = false;

  for (const line of content.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^(#{1,6})\s+(\S.*)$/);
    if (match) headings.push({ level: match[1].length, text: match[2].trim() });
  }

  return headings;
}

// [[[label|urn]]] is the mention format shared with the backend and the web app
// (see .agents/rules/architecture.md). Deduplicated by URN, first label wins.
export function parseOutgoingMentions(content: string): OutgoingMention[] {
  const mentionRegex = /\[\[\[([^\]|]+)\|([^\]]+)\]\]\]/g;
  const mentions: OutgoingMention[] = [];
  const seen = new Set<string>();
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    const [, label, urn] = match;
    if (seen.has(urn)) continue;
    seen.add(urn);
    mentions.push({ label, urn });
  }
  return mentions;
}

export function countWords(content: string): number {
  const trimmed = content.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
