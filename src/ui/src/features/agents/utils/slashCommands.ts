// Detect a "/skill" typeahead token immediately before the cursor. Returns the
// token start index and the partial query, or null when no token is open. The
// "/" must sit at start-of-input or after whitespace, and the query must be a
// single whitespace-free run (skill names are single tokens).
export function computeSlashToken(
  textBeforeCursor: string,
): { start: number; query: string } | null {
  const lastSlashIndex = textBeforeCursor.lastIndexOf("/");
  if (lastSlashIndex === -1) return null;

  const charBefore = lastSlashIndex > 0 ? textBeforeCursor[lastSlashIndex - 1] : null;
  if (charBefore !== null && !/\s/.test(charBefore)) return null;

  const query = textBeforeCursor.slice(lastSlashIndex + 1);
  if (/\s/.test(query)) return null;

  return { start: lastSlashIndex, query };
}

// The typeahead token breaks at the first space, so a message typed straight
// through ("/review https://...") never opens the popup and would otherwise
// send as literal text. Resolve that leading command at send time instead.
// Only an exact skill-name match counts, so "/etc/hosts" stays plain text.
export function matchLeadingSkillCommand<T extends { name: string }>(
  content: string,
  skills: readonly T[],
): { skill: T; rest: string } | null {
  const match = /^\/([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(content);
  if (!match) return null;

  const typed = match[1].toLowerCase();
  const skill = skills.find((s) => s.name.toLowerCase() === typed);
  if (!skill) return null;

  return { skill, rest: (match[2] ?? "").trim() };
}
