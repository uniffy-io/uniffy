import { CheckCircle } from "@phosphor-icons/react";
import { stagger } from "@/components/orbit/stagger";
import { HandleChip, StepActions, StepFrame } from "@/features/onboarding/components/StepFrame";
import { cn } from "@/shared/utils/cn";

interface WelcomeStepProps {
  organizationName: string;
  organizationSlug: string;
  onNext: () => void;
}

const PROMISES = ["Private by default", "One @ for everything", "AI that follows your permissions"];

export function WelcomeStep({ organizationName, organizationSlug, onNext }: WelcomeStepProps) {
  const promises = stagger(3);
  return (
    <StepFrame
      hero
      eyebrow={<HandleChip handle={organizationSlug} />}
      title={
        <>
          Welcome to <span className="text-primary">{organizationName}</span>.
        </>
      }
      lede={
        <>
          This is your team&apos;s new home. Notes, chat, files, calls, projects, calendars and AI
          agents live here together, and everything stays private to you until you share it. We
          already opened a <span className="font-medium text-foreground">#general</span> channel and
          an agent called <span className="font-medium text-foreground">NavigatorAgent</span>. Give
          us two minutes and we will set up the rest with you.
        </>
      }
      actions={<StepActions index={4} primaryLabel="Let's set it up" onPrimary={onNext} />}
    >
      <ul className={cn("flex flex-wrap gap-2", promises.className)} style={promises.style}>
        {PROMISES.map((promise) => (
          <li
            key={promise}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs text-muted-foreground shadow-edge"
          >
            <CheckCircle size={14} weight="fill" className="text-primary" />
            {promise}
          </li>
        ))}
      </ul>
    </StepFrame>
  );
}
