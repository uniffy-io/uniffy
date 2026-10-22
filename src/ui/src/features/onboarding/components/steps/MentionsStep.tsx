import { useEffect, useState } from "react";
import type { Icon } from "@phosphor-icons/react";
import { stagger } from "@/components/orbit/stagger";
import { getContentTypeIcon } from "@/config/theme/contentTypes";
import { getUrnTypeTheme } from "@/config/theme/urnColors";
import { Eyebrow, StepActions, StepFrame } from "@/features/onboarding/components/StepFrame";
import { cn } from "@/shared/utils/cn";
import { UrnType } from "@/shared/utils/urnTypes";

interface MentionsStepProps {
  onNext: () => void;
  onBack: () => void;
}

interface DemoMention {
  type: UrnType;
  icon: Icon;
  label: string;
  meta: string;
}

const demo = (type: UrnType, label: string, meta: string): DemoMention => ({
  type,
  icon: getContentTypeIcon(type),
  label,
  meta,
});

const MENTIONS: DemoMention[] = [
  demo(UrnType.NOTE, "Roadmap", "Note · edited just now"),
  demo(UrnType.CALENDAR_EVENT, "Standup", "Event · today 09:30"),
  demo(UrnType.FILE, "budget.xlsx", "File · 48 KB"),
];

const PING_INTERVAL_MS = 2400;

function DemoChip({ mention, index }: { mention: DemoMention; index: number }) {
  const theme = getUrnTypeTheme(mention.type);
  const MentionIcon = mention.icon;
  const enter = stagger(index);
  return (
    <span
      className={cn(
        "mx-0.5 inline-flex -translate-y-px items-center gap-1 rounded-md border px-1.5 py-px align-middle text-[0.92em] font-medium",
        theme.border,
        theme.badgeBg,
        theme.accentText,
        enter.className,
      )}
      style={enter.style}
    >
      <MentionIcon size={13} weight="duotone" />
      {mention.label}
    </span>
  );
}

function DemoCard({
  mention,
  index,
  ping,
}: {
  mention: DemoMention;
  index: number;
  ping: boolean;
}) {
  const theme = getUrnTypeTheme(mention.type);
  const MentionIcon = mention.icon;
  const enter = stagger(index);
  return (
    <div className={enter.className} style={enter.style}>
      <div
        className={cn(
          "flex min-w-0 items-center gap-3 rounded-xl bg-card px-3 py-2.5 transition-shadow duration-500",
          ping ? "shadow-edge-primary" : "shadow-edge",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            theme.iconBoxAccent,
          )}
        >
          <MentionIcon size={16} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">
            {mention.label}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{mention.meta}</span>
        </span>
      </div>
    </div>
  );
}

export function MentionsStep({ onNext, onBack }: MentionsStepProps) {
  const [ping, setPing] = useState(0);
  const composer = stagger(3);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setPing((value) => value + 1), PING_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <StepFrame
      eyebrow={<Eyebrow>Mentions, but for everything</Eyebrow>}
      title={
        <>
          One <span className="text-primary">@</span> pulls in anything.
        </>
      }
      lede={
        <>
          Type @ anywhere. A note, a file, a task, a meeting, a person, an agent. It becomes a live
          chip that always shows the current title, owner and status. Change the source once and
          every mention catches up. No copy and paste, no broken links.
        </>
      }
      actions={<StepActions index={8} primaryLabel="Continue" onPrimary={onNext} onBack={onBack} />}
    >
      <div className={composer.className} style={composer.style}>
        <div className="overflow-hidden rounded-xl bg-surface shadow-edge">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground"># general</span>
            <span className="flex items-center gap-1.5 text-[11px] text-green-700 dark:text-green-400">
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              live
            </span>
          </div>
          <p className="px-4 py-3.5 text-sm leading-7 text-foreground">
            Can someone review <DemoChip mention={MENTIONS[0]} index={4} /> before{" "}
            <DemoChip mention={MENTIONS[1]} index={5} />? The numbers are in{" "}
            <DemoChip mention={MENTIONS[2]} index={6} />.
            <span className="onb-caret" aria-hidden />
          </p>
        </div>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
          {MENTIONS.map((mention, index) => (
            <DemoCard
              key={mention.label}
              mention={mention}
              index={5 + index}
              ping={ping % MENTIONS.length === index && ping > 0}
            />
          ))}
        </div>
      </div>
    </StepFrame>
  );
}
