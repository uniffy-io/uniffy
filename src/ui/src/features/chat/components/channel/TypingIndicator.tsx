/** Always-mounted, fixed-height typing/working indicator pinned above the composer
 *  (no layout shift). Agents get a bare wave + Stop - no name or avatar - so the
 *  control stays put near the message box while the reply scrolls; humans get an
 *  understated row. */

import { Stop } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { SubjectAvatarById } from "@/components/subject";

interface TypingEntry {
  userId: string;
  displayName: string;
  isAgent?: boolean;
}

interface TypingIndicatorProps {
  typingUsers: TypingEntry[];
  /** When provided, the agent row shows a Stop control; called per active agent id. */
  onStopAgent?: (agentId: string) => void;
}

function buildTypingText(users: { displayName: string }[]): string {
  if (users.length === 0) return "";
  if (users.length === 1) return `${users[0].displayName} is typing`;
  if (users.length === 2) return `${users[0].displayName} and ${users[1].displayName} are typing`;
  return "Several people are typing";
}

/** Equalizer-style "thinking" motion - bars breathe in a staggered wave. */
function ThinkingWave({ tone }: { tone: "agent" | "human" }) {
  return (
    <span className="flex h-3 items-center gap-[3px]" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "uniffy-typing-bar h-full w-[3px] rounded-full",
            tone === "agent" ? "bg-primary" : "bg-muted-foreground/70",
          )}
          style={{ animationDelay: `${i * 0.13}s` }}
        />
      ))}
    </span>
  );
}

function AgentWorkingRow({
  agentIds,
  onStopAgent,
}: {
  agentIds: string[];
  onStopAgent?: (agentId: string) => void;
}) {
  return (
    <div
      className="uniffy-typing-enter pointer-events-auto inline-flex items-center gap-2.5"
      data-testid="chat-agent-working"
    >
      <ThinkingWave tone="agent" />
      {onStopAgent && (
        <button
          type="button"
          onClick={() => agentIds.forEach((id) => onStopAgent(id))}
          className="inline-flex h-6 items-center gap-1 rounded-full bg-muted pl-1.5 pr-2 text-muted-foreground transition-colors hover:bg-red-500/15 hover:text-red-500"
          data-testid="chat-agent-stop"
          title="Stop the agent"
        >
          <Stop size={11} weight="fill" />
          <span className="text-[11px] font-medium">Stop</span>
        </button>
      )}
    </div>
  );
}

function HumanTypingRow({ users }: { users: TypingEntry[] }) {
  const visible = users.slice(0, 3);
  return (
    <div className="uniffy-typing-enter inline-flex items-center gap-2 text-xs text-muted-foreground">
      <div className="flex items-center -space-x-1">
        {visible.map((u) => (
          <div key={u.userId} className="rounded-full ring-2 ring-background">
            <SubjectAvatarById userId={u.userId} displayName={u.displayName} size="xs" />
          </div>
        ))}
      </div>
      <span className="max-w-[220px] truncate">{buildTypingText(users)}</span>
      <ThinkingWave tone="human" />
    </div>
  );
}

export function TypingIndicator({ typingUsers, onStopAgent }: TypingIndicatorProps) {
  const agents = typingUsers.filter((u) => u.isAgent);
  const humans = typingUsers.filter((u) => !u.isAgent);

  // Fixed-height slot, always mounted: content swaps in/out with no layout shift.
  return (
    <div className="flex h-10 shrink-0 items-end px-3 pb-1.5" aria-live="polite">
      {agents.length > 0 ? (
        <AgentWorkingRow agentIds={agents.map((a) => a.userId)} onStopAgent={onStopAgent} />
      ) : humans.length > 0 ? (
        <HumanTypingRow users={humans} />
      ) : null}
    </div>
  );
}
