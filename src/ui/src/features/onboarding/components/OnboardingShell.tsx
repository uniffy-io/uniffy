import type { Ref } from "react";
import { Button } from "@/components/ui/button";
import { UniffyLogo } from "@/components/ui/uniffy-logo";
import type { OrbitScene } from "@/components/orbit/engine";
import { OrbitPage } from "@/components/orbit/OrbitPage";
import { ONBOARDING_STEPS, stepIndex, type OnboardingStepId } from "@/features/onboarding/steps";
import { cn } from "@/shared/utils/cn";

interface OnboardingShellProps {
  scene: OrbitScene;
  orbitRef: Ref<HTMLDivElement>;
  step: OnboardingStepId | null;
  organizationName: string;
  launching: boolean;
  onSkip: (() => void) | null;
  children: React.ReactNode;
}

function Progress({ step }: { step: OnboardingStepId }) {
  const at = stepIndex(step);
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
      <div
        className="hidden w-full max-w-sm items-center gap-1 md:flex"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={ONBOARDING_STEPS.length}
        aria-valuenow={at + 1}
        aria-valuetext={`Step ${at + 1} of ${ONBOARDING_STEPS.length}: ${ONBOARDING_STEPS[at].label}`}
      >
        {ONBOARDING_STEPS.map((entry, index) => (
          <span key={entry.id} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className={cn(
                "block h-full origin-left rounded-full bg-primary transition-transform duration-500 ease-out motion-reduce:transition-none",
                index <= at ? "scale-x-100" : "scale-x-0",
                index < at && "opacity-60",
              )}
            />
          </span>
        ))}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {at + 1} of {ONBOARDING_STEPS.length}
        <span className="hidden sm:inline">
          <span className="text-subtle-foreground"> &middot; </span>
          <span className="text-foreground">{ONBOARDING_STEPS[at].label}</span>
        </span>
      </span>
    </div>
  );
}

export function OnboardingShell({
  scene,
  orbitRef,
  step,
  organizationName,
  launching,
  onSkip,
  children,
}: OnboardingShellProps) {
  return (
    <OrbitPage
      scene={scene}
      orbitRef={orbitRef}
      orbitCaption={organizationName}
      launching={launching}
      scrollKey={step}
      header={
        <>
          <div className="flex min-w-0 shrink-0 items-center gap-2.5 md:w-56">
            <UniffyLogo className="h-6 w-6" />
            <span className="truncate text-sm font-semibold text-foreground">
              {organizationName}
            </span>
          </div>
          {step ? <Progress step={step} /> : <div className="flex-1" />}
          <div className="flex shrink-0 justify-end md:w-56">
            {onSkip && (
              <Button variant="ghost" size="md" onClick={onSkip}>
                Skip setup
              </Button>
            )}
          </div>
        </>
      }
    >
      {children}
    </OrbitPage>
  );
}
