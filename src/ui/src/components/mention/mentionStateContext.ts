import { createContext } from "react";
import { type MentionLiveState } from "@/components/mention/types";
import { type UrnMetadata } from "@uniffy/proto/search/v1/search_pb";

export type MentionDisplayMode = "expanded" | "compact";

export interface MentionStateContextValue {
  states: Map<string, MentionLiveState>;
  register: (urn: string, resolvedMetadata?: UrnMetadata) => void;
  unregister: (urn: string) => void;
  mentionDisplay: MentionDisplayMode;
}

/** Stable sentinel — identity comparison detects whether the provider is mounted. */
export const MENTION_NOOP = () => {};

// Lives apart from the provider components so a hot reload of them never
// re-creates the context the mounted provider serves.
export const MentionStateContext = createContext<MentionStateContextValue>({
  states: new Map(),
  register: MENTION_NOOP,
  unregister: MENTION_NOOP,
  mentionDisplay: "expanded",
});
