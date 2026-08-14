// Inline-only markup so the card stays HTML-valid as a descendant of `<p>`.
import { useState, useCallback } from "react";
import { ArrowSquareOut, CopySimple, Check, UsersThree } from "@phosphor-icons/react";
import { parseUrn } from "@/shared/utils/urn";
import { navigateTo } from "@/shared/utils/navigation";
import { ParentBadge, MetaSeparator } from "@/components/mention/previews/ParentBadge";
import type { MentionLiveState } from "@/components/mention/types";

interface TeamMentionPreviewProps {
  urn: string;
  title: string;
  description?: string;
  liveState: MentionLiveState;
  onClose: () => void;
  onCopyLink: () => void;
}

export function TeamMentionPreview({
  urn,
  title,
  description,
  liveState,
  onCopyLink,
}: TeamMentionPreviewProps) {
  const [copied, setCopied] = useState(false);
  const teamId = parseUrn(urn).id || "";

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(urn);
    setCopied(true);
    onCopyLink();
    setTimeout(() => setCopied(false), 2000);
  }, [urn, onCopyLink]);

  return (
    <>
      <span className="block relative px-4 pr-10 pt-3.5 pb-2 pl-5">
        <span className="flex items-start gap-3">
          <span className="grid place-items-center shrink-0 w-10 h-10 rounded-lg border border-primary/55 bg-primary/10 text-primary">
            <UsersThree size={18} weight="duotone" />
          </span>
          <span className="block flex-1 min-w-0 pt-0.5">
            <span className="block font-semibold text-sm truncate">{title}</span>
            <span className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-xs font-medium text-purple-600 dark:text-purple-400">Team</span>
              {liveState.parentLabel && (
                <>
                  <MetaSeparator />
                  <ParentBadge label={liveState.parentLabel} />
                </>
              )}
              {liveState.teamMemberCount != null && (
                <>
                  <MetaSeparator />
                  <span className="text-xs text-muted-foreground">
                    {liveState.teamMemberCount} member{liveState.teamMemberCount !== 1 ? "s" : ""}
                  </span>
                </>
              )}
            </span>
          </span>
        </span>
      </span>

      {description && (
        <span className="block px-4 pb-2.5 pl-5">
          <span className="block text-xs text-muted-foreground leading-relaxed line-clamp-3">
            {description}
          </span>
        </span>
      )}

      <span className="flex px-4 py-2.5 pl-5 bg-muted/30 border-t border-border/50 items-center gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigateTo(`/people?team=${teamId}`);
          }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowSquareOut size={12} />
          <span>Open in org chart</span>
        </button>
        <span className="flex-1" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleCopy();
          }}
          className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Copy URN"
        >
          {copied ? (
            <Check size={12} weight="bold" className="text-green-500" />
          ) : (
            <CopySimple size={12} weight="bold" />
          )}
        </button>
      </span>
    </>
  );
}
