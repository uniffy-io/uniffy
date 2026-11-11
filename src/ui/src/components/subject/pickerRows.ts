import { SUBJECT_TYPE, type Subject, type SubjectTypeFilter } from "@/components/subject/types";

interface PickerUser {
  id: string;
  username: string;
  fullName?: string;
  email: string;
  avatarUrl?: string;
}

interface PinnedRef {
  id: string;
  subjectId?: string;
}

/**
 * Who the picker lists, top to bottom, before the caller types: a "Me" row when `currentUser` is
 * given, the current picks, then suggestions. Nobody appears twice; a pinned row hides its person.
 */
export function buildPickerRows({
  currentUser,
  subjectTypes,
  excludeIds,
  pinnedOptions,
  value,
  resolvedSelected,
  results,
  suggested,
}: {
  currentUser: PickerUser | null;
  subjectTypes: SubjectTypeFilter;
  excludeIds: string[];
  pinnedOptions: PinnedRef[];
  value: string[];
  resolvedSelected: Subject[];
  results: Subject[];
  suggested: boolean;
}): { self: Subject | null; selectedRows: Subject[]; suggestions: Subject[] } {
  const self: Subject | null =
    currentUser &&
    subjectTypes !== "groups" &&
    !excludeIds.includes(currentUser.id) &&
    !pinnedOptions.some((option) => option.subjectId === currentUser.id)
      ? {
          id: currentUser.id,
          type: SUBJECT_TYPE.USER,
          name: currentUser.fullName || currentUser.username,
          email: currentUser.email,
          avatarUrl: currentUser.avatarUrl || undefined,
        }
      : null;
  const pinnedSubjectIds = new Set([
    ...(self ? [self.id] : []),
    ...pinnedOptions.flatMap((option) => option.subjectId ?? []),
  ]);
  const resultById = new Map(results.map((subject) => [subject.id, subject]));
  const selectedRows = resolvedSelected
    .filter((subject) => !pinnedSubjectIds.has(subject.id))
    .map((subject) => resultById.get(subject.id) ?? subject);
  const suggestions = suggested
    ? results.filter((subject) => !value.includes(subject.id) && !pinnedSubjectIds.has(subject.id))
    : [];
  return { self, selectedRows, suggestions };
}

/** Section rows whose name matches the search text; sections left empty are dropped. */
export function filterPickerSections<T extends { rows: readonly { subject: { name: string } }[] }>(
  sections: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  return sections
    .map((section) => ({
      ...section,
      rows: needle
        ? section.rows.filter((row) => row.subject.name.toLowerCase().includes(needle))
        : section.rows,
    }))
    .filter((section) => section.rows.length > 0);
}
