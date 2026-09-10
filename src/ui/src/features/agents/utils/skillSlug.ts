// Mirrors SKILL_NAME_MAX in domains/agents/skills/validation.py.
const SKILL_SLUG_MAX = 100;
const FALLBACK_SLUG = "skill";

export function slugifySkillName(displayName: string, fallback = FALLBACK_SLUG): string {
  // NFKD splits an accent off its base letter so dropping combining marks
  // keeps the letter: "Resume" rather than "re-sume".
  const slug = displayName
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_SLUG_MAX)
    .replace(/-+$/g, "");
  return slug || fallback;
}

// The slug is the stable identifier and the backend rejects duplicates within an
// org, so a collision is resolved here rather than surfaced as a save error.
export function deriveSkillSlug(
  displayName: string,
  taken: Iterable<string>,
  fallback = FALLBACK_SLUG,
): string {
  const used = new Set(taken);
  const base = slugifySkillName(displayName, fallback);
  if (!used.has(base)) return base;

  for (let suffix = 2; ; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${base.slice(0, SKILL_SLUG_MAX - tail.length).replace(/-+$/g, "")}${tail}`;
    if (!used.has(candidate)) return candidate;
  }
}
