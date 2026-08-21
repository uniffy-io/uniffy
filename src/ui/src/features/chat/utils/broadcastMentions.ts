/** Channel-wide broadcast mentions (@channel/@here) carried as broadcast URNs. */

import { create } from "@bufbuild/protobuf";
import { SearchResultItemSchema, type SearchResultItem } from "@uniffy/proto/search/v1/search_pb";
import { extractMentionsFromMarkdown } from "@/shared/utils/mentionUtils";
import { BROADCAST_URN_PREFIX } from "@/shared/utils/urn";

export { BROADCAST_URN_PREFIX } from "@/shared/utils/urn";

/** Client-side fallback while the org policy has not loaded; mirrors the backend default. */
export const DEFAULT_BROADCAST_CONFIRM_THRESHOLD = 25;

export type BroadcastKind = "channel" | "here";

export const BROADCAST_KINDS: readonly BroadcastKind[] = ["channel", "here"];

export function broadcastUrn(kind: BroadcastKind): string {
  return `${BROADCAST_URN_PREFIX}${kind}`;
}

export function broadcastKindFromUrn(urn: string): BroadcastKind | null {
  if (!urn.startsWith(BROADCAST_URN_PREFIX)) return null;
  const kind = urn.slice(BROADCAST_URN_PREFIX.length);
  return (BROADCAST_KINDS as readonly string[]).includes(kind) ? (kind as BroadcastKind) : null;
}

export function broadcastMentionsIn(markdown: string): BroadcastKind[] {
  const kinds = new Set<BroadcastKind>();
  for (const mention of extractMentionsFromMarkdown(markdown)) {
    const kind = broadcastKindFromUrn(mention.urn);
    if (kind) kinds.add(kind);
  }
  return [...kinds];
}

/** Widest kind wins: @channel reaches the whole roster, @here only online members. */
export function effectiveBroadcastKind(kinds: BroadcastKind[]): BroadcastKind | null {
  if (kinds.length === 0) return null;
  return kinds.includes("channel") ? "channel" : "here";
}

const BROADCAST_DESCRIPTIONS: Record<BroadcastKind, string> = {
  channel: "Notify everyone in this channel",
  here: "Notify channel members who are online right now",
};

/** Typeahead entries the mention popup prepends; label matches what the chip stores. */
export function buildBroadcastEntries(): SearchResultItem[] {
  return BROADCAST_KINDS.map((kind) =>
    create(SearchResultItemSchema, {
      urn: broadcastUrn(kind),
      title: `@${kind}`,
      description: BROADCAST_DESCRIPTIONS[kind],
    }),
  );
}
