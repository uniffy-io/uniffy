/**
 * Shared parent-container breadcrumb for mention preview cards.
 *
 * Used by chat (category), note (folder), and file (folder) chips so
 * the "lives inside X" hint sits in the same slot every time -- first
 * item in the meta row, just before the type label. Keeping the visual
 * treatment in one place avoids per-type drift.
 */

import { FolderSimple } from '@phosphor-icons/react';

interface ParentBadgeProps {
  label: string;
}

export function ParentBadge({ label }: ParentBadgeProps) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted-foreground truncate max-w-[140px]"
      title={`In: ${label}`}
    >
      <FolderSimple size={11} weight="duotone" className="shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Inline middle-dot used between meta-row entries. */
export function MetaSeparator() {
  return <span className="text-muted-foreground/40">·</span>;
}
