import { useState } from "react";
import { CaretRight, Prohibit } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { MemberRow } from "@/features/permissions/components/MemberRow";
import type { SerializedContentMember } from "@/features/permissions/store/permissionsSlice";

interface BlockedMembersSectionProps {
  members: SerializedContentMember[];
  canEdit: boolean;
  onUnblock: (member: SerializedContentMember) => Promise<void> | void;
}

export function BlockedMembersSection({ members, canEdit, onUnblock }: BlockedMembersSectionProps) {
  const [open, setOpen] = useState(false);
  if (members.length === 0) return null;

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <CaretRight
          size={14}
          weight="bold"
          className={cn("transition-transform", open && "rotate-90")}
        />
        <Prohibit size={14} weight="bold" />
        Blocked ({members.length})
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {members.map((m) => (
            <MemberRow
              key={`${m.subjectType}:${m.subjectId}`}
              member={m}
              canEdit={canEdit}
              onUpdate={async () => {
                await onUnblock(m);
              }}
              onRemove={async () => {
                await onUnblock(m);
              }}
              blocked
            />
          ))}
        </div>
      )}
    </div>
  );
}
