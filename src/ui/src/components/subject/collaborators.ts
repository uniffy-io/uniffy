import { CollaboratorTier, type Collaborator } from "@uniffy/proto/people/v1/people_pb";
import { peopleApi } from "@/features/people/api/peopleApi";
import { SUBJECT_TYPE, type Subject, type SubjectTier } from "@/components/subject/types";

const PICK_FLUSH_MS = 2_000;
export const PEOPLE_PAGE_SIZE = 20;
// The server's caps on one ListCollaborators exclusion list and one RecordPeoplePicks call.
const MAX_EXCLUDED_IDS = 100;
const MAX_PICKS_PER_CALL = 20;

const TIERS: Record<number, SubjectTier> = {
  [CollaboratorTier.COLLABORATOR]: "collaborator",
  [CollaboratorTier.TEAMMATE]: "teammate",
  [CollaboratorTier.MEMBER]: "member",
};

export function collaboratorToSubject(collaborator: Collaborator): Subject | null {
  const member = collaborator.member;
  if (!member) return null;
  return {
    id: member.userId,
    type: SUBJECT_TYPE.USER,
    name: member.displayName,
    email: member.email,
    avatarUrl: member.avatarUrl || undefined,
    tier: TIERS[collaborator.tier],
  };
}

function toSubjects(collaborators: Collaborator[]): Subject[] {
  return collaborators.flatMap((c) => collaboratorToSubject(c) ?? []);
}

const SUGGESTION_DEDUPE_MS = 2_000;

interface SuggestionEntry {
  at: number;
  promise: Promise<Subject[]>;
  value?: Subject[];
}

const suggestions = new Map<string, SuggestionEntry>();
const pendingPicks = new Map<string, Set<string>>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function suggestionKey(organizationId: string, userId: string): string {
  // A ranking is personal, and a tab can sign in as someone else.
  return `${organizationId}:${userId}`;
}

/** The last ranked list this tab saw, so a picker can paint before the refresh lands. */
export function cachedSuggestedPeople(organizationId: string, userId: string): Subject[] | null {
  return suggestions.get(suggestionKey(organizationId, userId))?.value ?? null;
}

/**
 * The caller's ranked colleagues for an empty picker. Every open refetches, since the ranking
 * moves with work the tab never sees (a message received, an assignment elsewhere); opens a
 * moment apart share one request.
 */
export function loadSuggestedPeople(organizationId: string, userId: string): Promise<Subject[]> {
  const key = suggestionKey(organizationId, userId);
  const cached = suggestions.get(key);
  if (cached && Date.now() - cached.at < SUGGESTION_DEDUPE_MS) return cached.promise;
  const promise = peopleApi
    .listCollaborators({ organizationId, limit: PEOPLE_PAGE_SIZE })
    .then(toSubjects);
  const entry: SuggestionEntry = { at: Date.now(), promise, value: cached?.value };
  suggestions.set(key, entry);
  promise.then(
    (value) => {
      entry.value = value;
    },
    () => {
      if (suggestions.get(key) === entry) suggestions.delete(key);
    },
  );
  return promise;
}

function invalidateSuggestedPeople(): void {
  suggestions.clear();
}

/** Forget this session's ranking and drop picks not yet sent, so none land on the next one. */
export function resetPeoplePickerSession(): void {
  suggestions.clear();
  pendingPicks.clear();
  if (flushTimer !== undefined) clearTimeout(flushTimer);
  flushTimer = undefined;
}

/** Matches for `query`, or uncached suggestions when it is empty, leaving out `excludeUserIds`. */
export async function searchPeople(
  organizationId: string,
  query: string,
  excludeUserIds: string[] = [],
): Promise<Subject[]> {
  const collaborators = await peopleApi.listCollaborators({
    organizationId,
    query,
    limit: PEOPLE_PAGE_SIZE,
    excludeUserIds: excludeUserIds.slice(0, MAX_EXCLUDED_IDS),
  });
  return toSubjects(collaborators);
}

function flushPicks(): void {
  flushTimer = undefined;
  for (const [organizationId, ids] of pendingPicks) {
    const userIds = [...ids].slice(0, MAX_PICKS_PER_CALL);
    // Picks only tune suggestions, so a failed send is dropped rather than surfaced.
    void peopleApi.recordPeoplePicks(organizationId, userIds).then(
      () => invalidateSuggestedPeople(),
      () => undefined,
    );
  }
  pendingPicks.clear();
}

/** Remember that the caller chose these people, batched so a burst of toggles is one call. */
export function recordPeoplePicks(organizationId: string, userIds: string[]): void {
  if (userIds.length === 0) return;
  const set = pendingPicks.get(organizationId) ?? new Set<string>();
  for (const id of userIds) set.add(id);
  pendingPicks.set(organizationId, set);
  if (flushTimer === undefined) flushTimer = setTimeout(flushPicks, PICK_FLUSH_MS);
}
