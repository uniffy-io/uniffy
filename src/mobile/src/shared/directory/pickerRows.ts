import type { ReactNode } from "react";
import type { DirectorySubject } from "@shared/directory/useDirectory";

/** A row above the people list that is an action, not a match ("Assign to me", "Unassigned"). */
export interface PickerPinnedRow {
  id: string;
  label: string;
  selected: boolean;
  onPress: () => void;
  leading?: ReactNode;
  subtitle?: string;
  /** The person the row stands for, so they are not listed again below it. */
  subjectId?: string;
}

/** A titled group of non-person rows listed after the people (for example a task's agents). */
export interface PickerSection {
  id: string;
  title: string;
  rows: PickerPinnedRow[];
}

/** Section rows whose label matches the search text; sections left empty are dropped. */
export function filterPickerSections(sections: PickerSection[], query: string): PickerSection[] {
  const needle = query.trim().toLowerCase();
  return sections
    .map((section) => ({
      ...section,
      rows: needle
        ? section.rows.filter((row) => row.label.toLowerCase().includes(needle))
        : section.rows,
    }))
    .filter((section) => section.rows.length > 0);
}

export interface PickerRows {
  selected: DirectorySubject[];
  rest: DirectorySubject[];
}

/**
 * Splits a picker's people into the current picks and everything else, in server order.
 * With an empty query the picks come first so deselecting never means scrolling; while
 * searching, matches keep their ranking and picks stay where they fall.
 */
export function orderPickerRows({
  selectedIds,
  resolveSelected,
  results,
  pinned,
  searching,
}: {
  selectedIds: string[];
  resolveSelected: (id: string) => DirectorySubject | undefined;
  results: DirectorySubject[];
  pinned: PickerPinnedRow[];
  searching: boolean;
}): PickerRows {
  const pinnedIds = new Set(pinned.flatMap((row) => (row.subjectId ? [row.subjectId] : [])));
  const seen = new Set<string>();
  const unique = results.filter((subject) => {
    const key = `${subject.kind}:${subject.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (searching) return { selected: [], rest: unique };

  const selectedSet = new Set(selectedIds);
  const byId = new Map(unique.map((subject) => [subject.id, subject]));
  const selected = selectedIds
    .filter((id) => !pinnedIds.has(id))
    .flatMap((id) => {
      const subject = byId.get(id) ?? resolveSelected(id);
      return subject ? [subject] : [];
    });
  const rest = unique.filter(
    (subject) => !selectedSet.has(subject.id) && !pinnedIds.has(subject.id),
  );
  return { selected, rest };
}
