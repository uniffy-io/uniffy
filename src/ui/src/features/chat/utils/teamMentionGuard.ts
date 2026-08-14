/** Sizing a team ping before it is sent, so nobody blasts a 40-person team by accident. */

import { getMentionState } from "@/components/mention/mentionStateEmitter";
import {
  getCachedPreview,
  resolveUrnBatched,
} from "@/components/mention/useBatchedSubjectResolver";
import { extractMentionsFromMarkdown, type ParsedMention } from "@/shared/utils/mentionUtils";
import { parseUrn, UrnType } from "@/shared/utils/urn";

export const TEAM_MENTION_CONFIRM_THRESHOLD = 10;

export interface TeamMentionTotal {
  total: number;
  labels: string[];
}

export function teamMentionsIn(markdown: string): ParsedMention[] {
  return extractMentionsFromMarkdown(markdown).filter(
    (mention) => parseUrn(mention.urn).type === UrnType.TEAM,
  );
}

export function needsTeamMentionConfirm(total: number): boolean {
  return total > TEAM_MENTION_CONFIRM_THRESHOLD;
}

/**
 * Sums across teams, so somebody on two mentioned teams counts twice; the copy
 * says "up to" rather than pretending the server-side set is known here.
 */
export async function resolveTeamMentionTotal(
  mentions: ParsedMention[],
  organizationId: string,
): Promise<TeamMentionTotal> {
  const counts = await Promise.all(
    mentions.map((mention) => resolveMemberCount(mention.urn, organizationId)),
  );
  return {
    total: counts.reduce((sum, count) => sum + count, 0),
    labels: mentions.map((mention) => mention.label),
  };
}

async function resolveMemberCount(urn: string, organizationId: string): Promise<number> {
  const known = getMentionState(urn)?.teamMemberCount;
  if (typeof known === "number") return known;

  await resolveUrnBatched(urn, organizationId);

  const fromPreview = getCachedPreview(urn)?.metadata?.["member_count"];
  if (fromPreview !== undefined) {
    const parsed = Number.parseInt(fromPreview, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  // An unresolvable team still keeps its label in the dialog, it just adds nothing.
  return getMentionState(urn)?.teamMemberCount ?? 0;
}
