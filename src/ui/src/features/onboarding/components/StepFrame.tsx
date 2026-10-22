import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import { stagger } from "@/components/orbit/stagger";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/utils/cn";

interface StepActionsProps {
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  busy?: boolean;
  onBack?: () => void;
  /** A quiet way past the step that writes nothing. */
  onSkip?: () => void;
  skipLabel?: string;
  index: number;
}

export function StepActions({
  primaryLabel,
  onPrimary,
  primaryDisabled,
  busy,
  onBack,
  onSkip,
  skipLabel = "Skip for now",
  index,
}: StepActionsProps) {
  const enter = stagger(index);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", enter.className)} style={enter.style}>
      {onBack && (
        <Button variant="outline" size="lg" onClick={onBack} aria-label="Back" className="w-9 px-0">
          <ArrowLeft size={16} />
        </Button>
      )}
      <Button size="lg" onClick={onPrimary} disabled={primaryDisabled} loading={busy}>
        {primaryLabel}
        <ArrowRight size={16} weight="bold" />
      </Button>
      {onSkip && (
        <Button variant="ghost" size="lg" onClick={onSkip} className="text-muted-foreground">
          {skipLabel}
        </Button>
      )}
    </div>
  );
}

interface StepFrameProps {
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  lede: React.ReactNode;
  children?: React.ReactNode;
  actions: React.ReactNode;
  /** The welcome and launch screens take a larger headline. */
  hero?: boolean;
}

export function StepFrame({ eyebrow, title, lede, children, actions, hero }: StepFrameProps) {
  const eyebrowEnter = stagger(0);
  const titleEnter = stagger(1);
  const ledeEnter = stagger(2);
  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center px-5 py-8 md:px-8 lg:mx-0 lg:max-w-2xl lg:px-12 lg:py-12 xl:pl-20">
      <div className={eyebrowEnter.className} style={eyebrowEnter.style}>
        {eyebrow}
      </div>
      <h1
        className={cn(
          "mt-4 font-semibold tracking-tight text-foreground text-balance",
          hero ? "text-3xl leading-tight md:text-[2.75rem]" : "text-2xl leading-tight md:text-4xl",
          titleEnter.className,
        )}
        style={titleEnter.style}
      >
        {title}
      </h1>
      <div
        className={cn(
          "mt-3 max-w-[34rem] text-[15px] leading-relaxed text-muted-foreground text-pretty",
          ledeEnter.className,
        )}
        style={ledeEnter.style}
      >
        {lede}
      </div>
      {children && <div className="mt-7">{children}</div>}
      <div className="mt-8">{actions}</div>
    </div>
  );
}

/** Small uppercase kicker above a step headline. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

/** The organization handle, set like a mention chip. */
export function HandleChip({ handle }: { handle: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
      <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />@{handle}
    </span>
  );
}
