import { memo, useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "@phosphor-icons/react";

import { useAppSelector } from "@/app/hooks";
import { useReactorNames } from "@/features/chat/hooks/useReactorNames";
import { popoverShellClass } from "@/components/ui/popover";
import { cn } from "@/shared/utils/cn";
import { buildReactorNames } from "@/features/chat/utils/reactorNames";

const EMOJI_UNICODE: Record<string, string> = {
  thumbs_up: "\u{1F44D}",
  thumbs_down: "\u{1F44E}",
  heart: "\u{2764}\u{FE0F}",
  fire: "\u{1F525}",
  eyes: "\u{1F440}",
  check: "\u{2705}",
  party: "\u{1F389}",
  laughing: "\u{1F602}",
  thinking: "\u{1F914}",
  clap: "\u{1F44F}",
  rocket: "\u{1F680}",
  wave: "\u{1F44B}",
  pray: "\u{1F64F}",
  bulb: "\u{1F4A1}",
  warning: "\u{26A0}\u{FE0F}",
};

function renderEmoji(key: string): string {
  return EMOJI_UNICODE[key] ?? key;
}

interface ReactionView {
  emoji: string;
  count: number;
  userIds: string[];
  hasCurrentUser: boolean;
}

function ReactorCard({
  reaction,
  names,
  remaining,
  anchor,
}: {
  reaction: ReactionView;
  names: string[];
  remaining: number;
  anchor: DOMRect;
}) {
  // Prefer above the chip; flip below when the message sits near the top of the viewport.
  const flip = anchor.top < 220;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 232));

  return createPortal(
    <div
      role="tooltip"
      className="fixed z-[1000] w-[220px]"
      style={
        flip
          ? { top: anchor.bottom + 8, left }
          : { top: anchor.top - 8, left, transform: "translateY(-100%)" }
      }
      data-testid={`chat-reaction-card-${reaction.emoji}`}
    >
      <div className={cn(popoverShellClass, "p-2")}>
        <div className="flex items-center gap-1.5 pb-1 mb-1 border-b border-border/60">
          <span className="text-[15px] leading-none">{renderEmoji(reaction.emoji)}</span>
          <span className="text-xs text-muted-foreground">
            {reaction.count === 1 ? "1 reaction" : `${reaction.count} reactions`}
          </span>
        </div>
        <ul className="space-y-0.5">
          {names.map((name) => (
            <li key={name} className="text-xs text-foreground truncate">
              {name}
            </li>
          ))}
          {remaining > 0 && (
            <li className="text-xs text-subtle-foreground">and {remaining} more</li>
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

function ReactionChip({
  reaction,
  channelId,
  currentUserId,
  onToggleReaction,
}: {
  reaction: ReactionView;
  channelId: string;
  currentUserId: string | undefined;
  onToggleReaction?: (emoji: string) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const nameById = useReactorNames(channelId, reaction.userIds, anchor !== null);

  const { names, remaining } = useMemo(
    () => buildReactorNames(reaction, nameById, currentUserId),
    [reaction, nameById, currentUserId],
  );

  const show = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setAnchor(rect);
  }, []);
  const hide = useCallback(() => setAnchor(null), []);

  return (
    <>
      <button
        ref={buttonRef}
        className={cn(
          "focus-ring inline-flex items-center justify-center min-h-11 min-w-11 gap-1 px-1.5 py-0.5 rounded-full border text-xs cursor-pointer transition-colors",
          reaction.hasCurrentUser
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-border bg-muted/50 hover:bg-muted",
        )}
        aria-label={`${reaction.emoji.replaceAll("_", " ")}: ${reaction.count} ${reaction.count === 1 ? "reaction" : "reactions"}. ${names.join(", ")}${remaining > 0 ? ` and ${remaining} more` : ""} reacted`}
        aria-pressed={reaction.hasCurrentUser}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => onToggleReaction?.(reaction.emoji)}
        data-testid={`chat-reaction-${reaction.emoji}`}
        data-active={reaction.hasCurrentUser ? "true" : "false"}
        data-count={reaction.count}
      >
        <span className="text-[14px] leading-none">{renderEmoji(reaction.emoji)}</span>
        <span className="font-medium">{reaction.count}</span>
      </button>
      {anchor && (
        <ReactorCard reaction={reaction} names={names} remaining={remaining} anchor={anchor} />
      )}
    </>
  );
}

interface ReactionBarProps {
  channelId: string;
  reactions: ReactionView[];
  onAddReaction?: () => void;
  onToggleReaction?: (emoji: string) => void;
}

function ReactionBarInner({
  channelId,
  reactions,
  onAddReaction,
  onToggleReaction,
}: ReactionBarProps) {
  const currentUserId = useAppSelector((state) => state.auth.user?.id);

  if (reactions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1" data-testid="chat-reaction-bar">
      {reactions.map((reaction) => (
        <ReactionChip
          key={reaction.emoji}
          reaction={reaction}
          channelId={channelId}
          currentUserId={currentUserId}
          onToggleReaction={onToggleReaction}
        />
      ))}
      <button
        className={cn(
          "focus-ring inline-flex items-center justify-center min-h-11 min-w-11 px-1.5 py-0.5 rounded-full",
          "border border-dashed border-border hover:border-primary/50",
          "text-muted-foreground hover:text-foreground transition-colors cursor-pointer",
        )}
        title="Add reaction"
        onClick={onAddReaction}
        data-testid="chat-reaction-add"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

export const ReactionBar = memo(ReactionBarInner);
