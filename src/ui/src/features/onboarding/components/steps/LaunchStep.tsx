import { useEffect } from "react";
import type { MentionDisplayMode } from "@/components/mention/mentionStateContext";
import {
  ChatCircleDots,
  CheckCircle,
  Circle,
  MagnifyingGlass,
  NotePencil,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { providerBrand } from "@/features/agents/config/providerBrands";
import { preloadDestination } from "@/features/onboarding/launch/destinations";
import { HandleChip, StepActions, StepFrame } from "@/features/onboarding/components/StepFrame";
import { stagger } from "@/components/orbit/stagger";
import { SHARING_OPTIONS, type SharingPreset } from "@/features/onboarding/sharing";
import { useFormattedKeybinding } from "@/features/settings";
import { cn } from "@/shared/utils/cn";

interface LaunchStepProps {
  organizationName: string;
  organizationSlug: string;
  sharing: SharingPreset;
  provider: string | null;
  mentionDisplay: MentionDisplayMode;
  invited: number;
  launching: boolean;
  onLaunch: (destination: string) => void;
  onBack: () => void;
}

interface Summary {
  done: boolean;
  label: string;
}

function SummaryRow({ item, index }: { item: Summary; index: number }) {
  const enter = stagger(index);
  const Mark = item.done ? CheckCircle : Circle;
  return (
    <li className={cn("flex items-center gap-2.5 text-sm", enter.className)} style={enter.style}>
      <Mark
        size={16}
        weight={item.done ? "fill" : "regular"}
        className={item.done ? "text-green-600 dark:text-green-400" : "text-subtle-foreground"}
      />
      <span className={item.done ? "text-foreground" : "text-muted-foreground"}>{item.label}</span>
    </li>
  );
}

export function LaunchStep({
  organizationName,
  organizationSlug,
  sharing,
  provider,
  mentionDisplay,
  invited,
  launching,
  onLaunch,
  onBack,
}: LaunchStepProps) {
  const searchKeys = useFormattedKeybinding("nav.search");

  useEffect(() => {
    preloadDestination("/");
  }, []);
  const moves = stagger(8);
  const sharingTitle = SHARING_OPTIONS.find((option) => option.id === sharing)?.title ?? "";

  const summary: Summary[] = [
    { done: true, label: `Shared notes and projects: ${sharingTitle.toLowerCase()}` },
    {
      done: true,
      label:
        mentionDisplay === "compact" ? "Mentions read as compact chips" : "Mentions open as cards",
    },
    { done: true, label: "Your color and mode are saved" },
    provider
      ? { done: true, label: `${providerBrand(provider)?.label ?? provider} powers NavigatorAgent` }
      : { done: false, label: "AI is off until you add a provider key" },
    invited > 0
      ? {
          done: true,
          label: `${invited} ${invited === 1 ? "invitation" : "invitations"} on the way`,
        }
      : { done: false, label: "Nobody invited yet" },
  ];

  const firstMoves: { icon: Icon; title: string; hint: string; to: string }[] = [
    { icon: ChatCircleDots, title: "Say hello", hint: "#general", to: "/chat" },
    { icon: NotePencil, title: "Write a note", hint: "Notes", to: "/notes" },
    { icon: MagnifyingGlass, title: "Find anything", hint: `Press ${searchKeys}`, to: "/" },
  ];

  return (
    <StepFrame
      hero
      eyebrow={<HandleChip handle={organizationSlug} />}
      title={
        <>
          {organizationName} is <span className="text-primary">ready</span>.
        </>
      }
      lede={<>Everything you skipped waits in the settings. Nothing here is final.</>}
      actions={
        <StepActions
          index={12}
          primaryLabel={`Enter ${organizationName}`}
          onPrimary={() => onLaunch("/")}
          busy={launching}
          onBack={onBack}
        />
      }
    >
      <ul className="grid gap-2">
        {summary.map((item, index) => (
          <SummaryRow key={item.label} item={item} index={3 + index} />
        ))}
      </ul>
      <div className={cn("mt-7 grid gap-2 sm:grid-cols-3", moves.className)} style={moves.style}>
        {firstMoves.map((move) => {
          const MoveIcon = move.icon;
          return (
            <button
              key={move.title}
              type="button"
              onClick={() => onLaunch(move.to)}
              onPointerEnter={() => preloadDestination(move.to)}
              onFocus={() => preloadDestination(move.to)}
              disabled={launching}
              className="focus-ring group flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5 text-left shadow-edge transition-shadow duration-150 hover:shadow-edge-strong disabled:opacity-50"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/55 bg-primary/10 text-primary">
                <MoveIcon size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{move.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{move.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </StepFrame>
  );
}
