import type { ReactNode } from "react";
import { SubjectAvatarById } from "@/components/subject";

/** One person in a call roster: avatar, name and live state, with optional row actions. */
export function CallPersonRow({
  userId,
  name,
  avatarUrl,
  label,
  state,
  children,
}: {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  /** Visible name line when it carries more than the name, like "(you)" or "Host". */
  label?: ReactNode;
  state: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 py-2">
      <SubjectAvatarById
        userId={userId}
        displayName={name}
        avatarUrl={avatarUrl ?? undefined}
        size="md"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label ?? name}</p>
        <p className="truncate text-xs text-muted-foreground">{state}</p>
      </div>
      {children && <div className="flex shrink-0 items-center gap-0.5">{children}</div>}
    </li>
  );
}
