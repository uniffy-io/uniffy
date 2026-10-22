import type { MentionDisplayMode } from "@/components/mention/mentionStateContext";
import { stagger } from "@/components/orbit/stagger";
import { Eyebrow, StepActions, StepFrame } from "@/features/onboarding/components/StepFrame";
import { MentionDisplayPicker } from "@/features/settings/components/MentionDisplayPicker";
import { useSettings } from "@/features/settings/hooks/useSettings";

interface MentionDisplayStepProps {
  value: MentionDisplayMode;
  onNext: () => void;
  onBack: () => void;
}

export function MentionDisplayStep({ value, onNext, onBack }: MentionDisplayStepProps) {
  const { updateSettings, saving } = useSettings();
  const picker = stagger(3);
  return (
    <StepFrame
      eyebrow={<Eyebrow>How mentions read</Eyebrow>}
      title={
        <>
          Cards or <span className="text-primary">chips</span>?
        </>
      }
      lede={
        <>
          A mention can open into a card with its live details, or stay a slim chip inside the
          sentence. Pick the one that reads best to you. Any single mention still opens or folds
          with a click, and you can change this later in settings.
        </>
      }
      actions={<StepActions index={8} primaryLabel="Continue" onPrimary={onNext} onBack={onBack} />}
    >
      <div className={picker.className} style={picker.style}>
        <MentionDisplayPicker
          value={value}
          disabled={saving}
          onChange={(mentionDisplay) => void updateSettings({ appearance: { mentionDisplay } })}
        />
      </div>
    </StepFrame>
  );
}
