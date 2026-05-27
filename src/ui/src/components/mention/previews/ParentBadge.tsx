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

export function MetaSeparator() {
  return <span className="text-muted-foreground/40">·</span>;
}
