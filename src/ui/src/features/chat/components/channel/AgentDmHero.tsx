import type { CSSProperties } from "react";
import { cn } from "@/shared/utils/cn";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";

const GRID_LINES =
  "linear-gradient(var(--agent-hero-grid) 1px, transparent 1px), linear-gradient(90deg, var(--agent-hero-grid) 1px, transparent 1px)";
const GRID_MASK = "radial-gradient(ellipse 70% 60% at 50% 44%, #000 28%, transparent 78%)";
const SPECTRUM_LINE =
  "linear-gradient(90deg, transparent 0%, rgba(105, 74, 255, 0.7) 18%, rgba(253, 126, 234, 0.7) 45%, rgba(255, 85, 0, 0.7) 68%, rgba(1, 183, 127, 0.8) 90%, transparent 100%)";

const enter = (delayMs: number): CSSProperties => ({
  animationDelay: `${delayMs}ms`,
  animationFillMode: "backwards",
});

/** Keeps the backdrop mounted while an empty agent DM becomes a conversation. */
export function AgentAuroraBackdrop({ intensity }: { intensity: "hero" | "flat" }) {
  return (
    <div
      className={cn(
        "absolute inset-0 -z-10 overflow-hidden transition-colors duration-1000",
        // Paints the whole message pane, so it takes the content sheet color.
        "bg-surface",
      )}
      aria-hidden="true"
      data-testid="chat-agent-aurora"
      data-intensity={intensity}
    >
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-1000 ease-out",
          intensity === "hero" ? "opacity-100" : "opacity-35",
        )}
      >
        <div
          className={cn(
            "absolute inset-0 [--agent-hero-grid:rgba(0,0,0,0.05)] dark:[--agent-hero-grid:rgba(255,255,255,0.035)] transition-opacity duration-1000",
            intensity === "hero" ? "opacity-100" : "opacity-0",
          )}
          style={{
            backgroundImage: GRID_LINES,
            backgroundSize: "60px 60px",
            backgroundPosition: "center",
            WebkitMaskImage: GRID_MASK,
            maskImage: GRID_MASK,
          }}
        />
        <div
          className={cn(
            "agent-hero-aurora agent-hero-aurora--violet transition-opacity duration-1000",
            intensity === "hero" ? "opacity-70 dark:opacity-100" : "opacity-0",
          )}
        />
        <div
          className={cn(
            "agent-hero-aurora agent-hero-aurora--pink transition-opacity duration-1000",
            intensity === "hero" ? "opacity-80 dark:opacity-100" : "opacity-0",
          )}
        />
        <div
          className={cn(
            "agent-hero-aurora agent-hero-aurora--green transition-opacity duration-1000",
            intensity === "hero" ? "opacity-80 dark:opacity-100" : "opacity-0",
          )}
        />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-px" style={{ background: SPECTRUM_LINE }} />
    </div>
  );
}

interface AgentDmGreetingProps {
  agentName: string;
  avatarKey?: string;
  avatarEmoji?: string;
  /** Plays the farewell (fade + lift) instead of the staggered entrance. */
  exiting?: boolean;
}

export function AgentDmGreeting({
  agentName,
  avatarKey,
  avatarEmoji,
  exiting = false,
}: AgentDmGreetingProps) {
  return (
    <div className={cn("flex flex-col items-center gap-4 text-center", exiting && "hero-exit")}>
      <div
        className={cn(
          "rounded-full p-1 ring-1 ring-border/60 dark:ring-white/10 shadow-[0_0_40px_-8px_rgba(105,74,255,0.5)]",
          !exiting && "hero-enter",
        )}
        style={exiting ? undefined : enter(0)}
      >
        <AgentAvatar
          avatarKey={avatarKey}
          avatarEmoji={avatarEmoji}
          agentName={agentName}
          size="xl"
        />
      </div>
      <div
        className={cn(
          "font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80",
          !exiting && "hero-enter",
        )}
        style={exiting ? undefined : enter(80)}
      >
        Private agent chat
      </div>
      <h1
        className={cn(
          "text-3xl md:text-4xl font-medium tracking-tight text-foreground dark:text-white/95 [text-wrap:balance]",
          !exiting && "hero-enter",
        )}
        style={exiting ? undefined : enter(140)}
      >
        {agentName}
      </h1>
      <p
        className={cn("text-sm text-muted-foreground", !exiting && "hero-enter")}
        style={exiting ? undefined : enter(200)}
      >
        Just the two of you. Pick a model, tune it, ask away.
      </p>
    </div>
  );
}
