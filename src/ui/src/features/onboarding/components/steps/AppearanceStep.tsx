import { Check, Desktop, Moon, Sun } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { stagger } from "@/components/orbit/stagger";
import { getInitials } from "@/components/subject/utils";
import { AvatarUpload } from "@/components/ui/avatar-upload";
import { OptionTile } from "@/components/ui/option-tile";
import { ACCENT_COLORS, BRAND_ACCENT_HEX, hslToHex } from "@/config/theme/accentColors";
import { useTheme } from "@/config/theme/themeContext";
import type { ThemeMode } from "@/config/theme/themeSlice";
import { Eyebrow, StepActions, StepFrame } from "@/features/onboarding/components/StepFrame";
import { useAvatarActions } from "@/features/settings/hooks/useAvatarActions";
import { useSettings } from "@/features/settings/hooks/useSettings";
import { avatarUrlAtVariant } from "@/shared/utils/fileUrls";
import { cn } from "@/shared/utils/cn";

interface AppearanceStepProps {
  onNext: () => void;
  onBack: () => void;
}

const MODES: { id: ThemeMode; label: string; description: string; icon: Icon }[] = [
  { id: "system", label: "System", description: "Follows your device", icon: Desktop },
  { id: "light", label: "Light", description: "Bright surfaces", icon: Sun },
  { id: "dark", label: "Dark", description: "Easy on the eyes", icon: Moon },
];

const SWATCHES = [
  { name: "Uniffy", value: undefined, hex: BRAND_ACCENT_HEX },
  ...ACCENT_COLORS.map((color) => ({ ...color, hex: hslToHex(color.value) })),
];

export function AppearanceStep({ onNext, onBack }: AppearanceStepProps) {
  const user = useAppSelector((state) => state.auth.user);
  const { themeMode, setTheme } = useTheme();
  const { effectiveSettings, updateSettings } = useSettings();
  const { uploadAvatar, deleteAvatar } = useAvatarActions();
  const accent = effectiveSettings?.appearance.accentColor || undefined;
  const body = stagger(3);

  const initials = user?.fullName
    ? getInitials(user.fullName)
    : (user?.username || "??").slice(0, 2).toUpperCase();

  return (
    <StepFrame
      eyebrow={<Eyebrow>Make it yours</Eyebrow>}
      title={
        <>
          A face, a color, <span className="text-primary">a mood</span>.
        </>
      }
      lede={
        <>
          Your teammates see your picture next to everything you write. The color and the mode are
          yours alone, and this page follows them as you pick.
        </>
      }
      actions={<StepActions index={8} primaryLabel="Continue" onPrimary={onNext} onBack={onBack} />}
    >
      <div className={cn("space-y-6", body.className)} style={body.style}>
        <div className="rounded-xl bg-surface p-4 shadow-edge">
          <AvatarUpload
            size="md"
            imageUrl={user?.avatarUrl ? avatarUrlAtVariant(user.avatarUrl, "lg") : undefined}
            fallback={initials}
            onUpload={uploadAvatar}
            onDelete={deleteAvatar}
          />
        </div>

        <div>
          <p className="mb-2 text-sm text-muted-foreground">Accent</p>
          <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Accent color">
            {SWATCHES.map((swatch) => {
              const selected = swatch.value === accent;
              return (
                <button
                  key={swatch.name}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={swatch.name}
                  title={swatch.name}
                  onClick={() => void updateSettings({ appearance: { accentColor: swatch.value } })}
                  className={cn(
                    "focus-ring flex h-8 w-8 items-center justify-center rounded-full transition-transform duration-200",
                    selected ? "scale-110" : "hover:scale-105",
                  )}
                  style={{
                    background: swatch.hex,
                    boxShadow: selected
                      ? `0 0 0 2px hsl(var(--background)), 0 0 0 4px ${swatch.hex}`
                      : "inset 0 0 0 1px rgba(0,0,0,0.08)",
                  }}
                >
                  {selected && <Check size={14} weight="bold" className="text-white" />}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm text-muted-foreground">Mode</p>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Color mode">
            {MODES.map((mode) => {
              const ModeIcon = mode.icon;
              return (
                <OptionTile
                  key={mode.id}
                  selected={themeMode === mode.id}
                  icon={<ModeIcon size={16} />}
                  label={mode.label}
                  description={mode.description}
                  onSelect={() => setTheme(mode.id)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </StepFrame>
  );
}
