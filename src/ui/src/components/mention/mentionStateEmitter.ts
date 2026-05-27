import type { MentionLiveState } from '@/components/mention/types';

type MentionStateListener = (urn: string, changes: Partial<MentionLiveState>) => void;

const listeners = new Set<MentionStateListener>();

export function onMentionStateChange(listener: MentionStateListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function emitMentionStateChange(urn: string, changes: Partial<MentionLiveState>): void {
  listeners.forEach((listener) => listener(urn, changes));
}

const mentionStates = new Map<string, MentionLiveState>();

export function getMentionState(urn: string): MentionLiveState | null {
  return mentionStates.get(urn) ?? null;
}

export function setMentionState(urn: string, state: MentionLiveState): void {
  mentionStates.set(urn, state);
}

/** Use from non-React resolution paths so outside-context chips wake up; plain `setMentionState` is silent. */
export function publishMentionState(urn: string, state: MentionLiveState): void {
  mentionStates.set(urn, state);
  listeners.forEach((listener) => listener(urn, state));
}

export function clearMentionStates(): void {
  mentionStates.clear();
  mentionUrls.clear();
}

const mentionUrls = new Map<string, string>();

export function setMentionUrl(urn: string, url: string): void {
  mentionUrls.set(urn, url);
}

export function getMentionUrl(urn: string): string | null {
  return mentionUrls.get(urn) ?? null;
}
