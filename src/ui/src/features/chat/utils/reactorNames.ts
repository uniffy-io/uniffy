export interface ReactorSummary {
  count: number;
  userIds: string[];
  hasCurrentUser: boolean;
}

/**
 * Names for a reaction chip: the viewer first, then the reactors the server
 * named. The reactor list is bounded, so `count` carries everyone left over.
 */
export function buildReactorNames(
  reaction: ReactorSummary,
  nameById: Record<string, string>,
  currentUserId: string | undefined,
): { names: string[]; remaining: number } {
  const names: string[] = [];
  if (reaction.hasCurrentUser) names.push("You");
  for (const id of reaction.userIds) {
    if (currentUserId && id === currentUserId) continue;
    names.push(nameById[id] ?? id.slice(-6));
  }
  return { names, remaining: Math.max(0, reaction.count - names.length) };
}
