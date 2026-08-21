/** Channel-wide broadcast mentions (@channel/@here) carried as broadcast URNs. */

export const BROADCAST_URN_PREFIX = "urn:uniffy:broadcast:";

export type BroadcastKind = "channel" | "here";

export const BROADCAST_KINDS: readonly BroadcastKind[] = ["channel", "here"];

/** Client-side fallback while the org policy has not loaded; mirrors the backend default. */
export const DEFAULT_BROADCAST_CONFIRM_THRESHOLD = 25;

export function broadcastUrn(kind: BroadcastKind): string {
  return `${BROADCAST_URN_PREFIX}${kind}`;
}

export function isBroadcastUrn(urn: string): boolean {
  return urn.startsWith(BROADCAST_URN_PREFIX);
}

export function broadcastKindFromUrn(urn: string): BroadcastKind | null {
  if (!isBroadcastUrn(urn)) return null;
  const kind = urn.slice(BROADCAST_URN_PREFIX.length);
  return (BROADCAST_KINDS as readonly string[]).includes(kind) ? (kind as BroadcastKind) : null;
}

const MENTION_RE = /\[\[\[([^[\]|]+)\|([^\]]+)\]\]\]/g;

export function broadcastMentionsIn(canonical: string): BroadcastKind[] {
  const kinds = new Set<BroadcastKind>();
  for (const match of canonical.matchAll(MENTION_RE)) {
    const kind = broadcastKindFromUrn(match[2]);
    if (kind) kinds.add(kind);
  }
  return [...kinds];
}

/** Widest kind wins: @channel reaches the whole roster, @here only online members. */
export function effectiveBroadcastKind(kinds: BroadcastKind[]): BroadcastKind | null {
  if (kinds.length === 0) return null;
  return kinds.includes("channel") ? "channel" : "here";
}
