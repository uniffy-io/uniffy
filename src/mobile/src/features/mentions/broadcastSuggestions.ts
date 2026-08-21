import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import { broadcastUrn, type BroadcastKind } from "@shared/mentions/broadcastMentions";
import type { SerializedSearchResult } from "@features/search/searchSerializer";

const DESCRIPTIONS: Record<BroadcastKind, string> = {
  channel: "Notify everyone in this channel",
  here: "Notify members online right now",
};

/** Synthetic typeahead rows for @channel/@here; never real search hits. */
export function buildBroadcastSuggestions(): SerializedSearchResult[] {
  return (["channel", "here"] as const).map((kind) => ({
    id: "",
    urn: broadcastUrn(kind),
    title: `@${kind}`,
    domain: null,
    type: SearchResultType.UNSPECIFIED,
    description: DESCRIPTIONS[kind],
    tags: [],
  }));
}
