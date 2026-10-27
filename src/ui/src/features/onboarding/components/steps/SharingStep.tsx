import { useEffect, useState } from "react";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  fetchPermissionDefaults,
  updatePermissionDefaults,
} from "@/features/admin/store/adminThunks";
import { Eyebrow, StepActions, StepFrame } from "@/features/onboarding/components/StepFrame";
import { stagger } from "@/components/orbit/stagger";
import { OptionTile } from "@/components/ui/option-tile";
import {
  SHARING_CONTENT_TYPES,
  SHARING_OPTIONS,
  roleForPreset,
  selectStoredSharingPreset,
  type SharingPreset,
} from "@/features/onboarding/sharing";
import { cn } from "@/shared/utils/cn";

interface SharingStepProps {
  preset: SharingPreset;
  onPresetChange: (preset: SharingPreset) => void;
  onNext: () => void;
  onBack: () => void;
}

function LevelMeter({ level }: { level: number }) {
  return (
    <span className="flex h-5 items-end gap-[3px]" aria-hidden>
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          className={cn(
            "w-1 rounded-full transition-colors duration-300",
            bar <= level ? "bg-primary" : "bg-muted-foreground/25",
          )}
          style={{ height: 6 + bar * 4 }}
        />
      ))}
    </span>
  );
}

export function SharingStep({ preset, onPresetChange, onNext, onBack }: SharingStepProps) {
  const dispatch = useAppDispatch();
  const stored = useAppSelector(selectStoredSharingPreset);
  const defaults = useAppSelector((state) => state.admin.permissionDefaults);
  const loading = useAppSelector((state) => state.admin.permissionDefaultsLoading);
  const error = useAppSelector((state) => state.admin.permissionDefaultsError);
  const [saving, setSaving] = useState(false);
  const list = stagger(3);

  useEffect(() => {
    void dispatch(fetchPermissionDefaults());
  }, [dispatch]);

  const loaded = SHARING_CONTENT_TYPES.every((contentType) =>
    defaults.some((entry) => entry.contentType === contentType),
  );
  const changed = preset !== stored;
  const continueLabel = changed ? "Save and continue" : "Continue";
  const loadLabel = error ? "Retry settings" : "Loading settings";

  const save = async () => {
    if (!loaded || loading || saving) return;
    if (!changed) {
      onNext();
      return;
    }
    setSaving(true);
    try {
      for (const contentType of SHARING_CONTENT_TYPES) {
        const current = defaults.find((entry) => entry.contentType === contentType);
        if (
          current?.defaultAccessMode === AccessMode.OPEN_TO_ORG &&
          current.defaultBaselineRole === roleForPreset(preset)
        )
          continue;
        await dispatch(
          updatePermissionDefaults({
            contentType,
            defaultAccessMode: AccessMode.OPEN_TO_ORG,
            defaultBaselineRole: roleForPreset(preset),
          }),
        ).unwrap();
      }
      onNext();
    } catch {
      // The rejected thunk already toasted; the owner stays here to retry or skip.
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepFrame
      eyebrow={<Eyebrow>Private until you share it</Eyebrow>}
      title={
        <>
          You decide who sees <span className="text-primary">what</span>.
        </>
      }
      lede={
        <>
          Everything anyone creates here starts private. Nobody else sees it, admins included. When
          someone shares a note or a project with the whole organization, this is what everyone else
          gets. They can always share with fewer people instead.
        </>
      }
      actions={
        <StepActions
          index={8}
          primaryLabel={loaded ? continueLabel : loadLabel}
          onPrimary={loaded ? save : () => dispatch(fetchPermissionDefaults())}
          primaryDisabled={loading || (!loaded && !error)}
          busy={saving}
          onBack={onBack}
          onSkip={onNext}
        />
      }
    >
      <div
        role="radiogroup"
        aria-label="What the organization gets on shared notes and projects"
        className={cn("grid gap-2", list.className)}
        style={list.style}
      >
        {SHARING_OPTIONS.map((option) => (
          <OptionTile
            key={option.id}
            selected={preset === option.id}
            icon={<LevelMeter level={option.level} />}
            label={option.title}
            description={option.id === stored ? `${option.body} Current setting.` : option.body}
            onSelect={() => onPresetChange(option.id)}
            disabled={saving}
          />
        ))}
      </div>
    </StepFrame>
  );
}
