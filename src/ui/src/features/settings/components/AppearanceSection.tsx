import {
  Sun,
  Moon,
  Desktop,
  Check,
  CheckSquare,
  CalendarBlank,
  ArrowSquareOut,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { TimezoneSelect } from "@/components/ui/timezone-select";
import { cn } from "@/shared/utils/cn";
import { useSettings, useAppearanceSettings } from "@/features/settings/hooks/useSettings";

// Theme token cascade: accent color (HSL) layers on top of base palette and mode (light/dark/system).
const ACCENT_COLORS = [
  { name: "Blue", value: "217 91% 60%" },
  { name: "Sky", value: "199 84% 50%" },
  { name: "Purple", value: "262.1 83.3% 57.8%" },
  { name: "Green", value: "142.1 76.2% 36.3%" },
  { name: "Orange", value: "24.6 95% 53.1%" },
  { name: "Red", value: "0 84.2% 60.2%" },
  { name: "Pink", value: "330 81% 60%" },
  { name: "Teal", value: "174 72% 40%" },
  { name: "Amber", value: "38 92% 50%" },
];

function hslToHex(hsl: string): string {
  const parts = hsl.split(" ");
  if (parts.length !== 3) return "#684aff";

  const h = parseFloat(parts[0]) / 360;
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHsl(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "217 91% 60%";

  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return `${(h * 360).toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%`;
}

const FONT_FAMILIES = [
  { id: "inter", name: "Inter", description: "Clean and modern", stack: "var(--font-inter)" },
  {
    id: "jakarta",
    name: "Plus Jakarta Sans",
    description: "The Uniffy brand font",
    stack: "var(--font-jakarta)",
  },
  { id: "geist", name: "Geist", description: "Vercel style", stack: "var(--font-geist)" },
  { id: "system", name: "System", description: "Native OS font", stack: "var(--font-system)" },
];

const EDITOR_OPTIONS = [
  { id: "crepe", name: "Editor", description: "Rich WYSIWYG editor with full formatting" },
  {
    id: "markdown",
    name: "Markdown",
    description: "Raw markdown source with optional live preview",
  },
  { id: "readonly", name: "Read Only", description: "View-only mode for reading notes" },
];

export function AppearanceSection() {
  const { updateSettings, saving } = useSettings();
  const appearance = useAppearanceSettings();

  const handleThemeChange = (theme: string) => {
    updateSettings({ appearance: { theme } });
  };

  const handleAccentColorChange = (accentColor: string | undefined) => {
    updateSettings({ appearance: { accentColor } });
  };

  const handleFontFamilyChange = (fontFamily: string) => {
    updateSettings({ appearance: { fontFamily } });
  };

  const handleDefaultEditorChange = (defaultEditor: string) => {
    updateSettings({ appearance: { defaultEditor } });
  };

  const handleMarkdownShowPreviewChange = (markdownShowPreview: boolean) => {
    updateSettings({ appearance: { markdownShowPreview } });
  };

  const handleMarkdownShowLineNumbersChange = (markdownShowLineNumbers: boolean) => {
    updateSettings({ appearance: { markdownShowLineNumbers } });
  };

  const handleMentionDisplayChange = (mentionDisplay: string) => {
    updateSettings({ appearance: { mentionDisplay } });
  };

  const handleTimezoneChange = (timezone: string) => {
    updateSettings({ appearance: { timezone } });
  };

  const handleWeekStartChange = (weekStart: string) => {
    updateSettings({ appearance: { weekStart } });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground mb-2">Appearance</h1>
        <p className="text-sm text-muted-foreground">Customize the look and feel of your Uniffy.</p>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Theme</h2>
          <p className="text-sm text-muted-foreground">Choose how the interface looks.</p>
        </div>

        <div className="grid grid-cols-3 gap-2 md:gap-4">
          {[
            { id: "light", label: "Light", icon: Sun },
            { id: "dark", label: "Dark", icon: Moon },
            { id: "system", label: "System", icon: Desktop },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              disabled={saving}
              className={`flex flex-col items-center gap-2 p-3 md:p-4 rounded-lg border-2 transition-colors ${
                appearance.theme === id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 bg-card"
              }`}
              onClick={() => handleThemeChange(id)}
            >
              <Icon size={32} weight="duotone" className="text-foreground" />
              <span className="text-sm font-medium text-foreground">{label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Date &amp; time</h2>
          <p className="text-sm text-muted-foreground">
            Times, dates and calendar weeks across the app follow these settings.
          </p>
        </div>

        <div className="flex max-w-2xl flex-col gap-4 md:flex-row md:items-end">
          <div className="min-w-0 flex-1 space-y-1.5">
            <label className="text-sm font-medium text-foreground">Timezone</label>
            <TimezoneSelect
              value={appearance.timezone ?? ""}
              onChange={handleTimezoneChange}
              disabled={saving}
              ariaLabel="Display timezone"
            />
          </div>
          <div className="shrink-0 space-y-1.5">
            <label className="text-sm font-medium text-foreground">Week start</label>
            <div className="flex gap-2">
              {[
                { id: "monday", label: "Monday" },
                { id: "saturday", label: "Saturday" },
                { id: "sunday", label: "Sunday" },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  disabled={saving}
                  onClick={() => handleWeekStartChange(id)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                    (appearance.weekStart ?? "monday") === id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-foreground hover:bg-muted",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Mention Display</h2>
          <p className="text-sm text-muted-foreground">
            Choose how mentions appear in chat, notes, and other content.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4">
          {[
            {
              id: "expanded",
              label: "Expanded",
              description: "Rich card with live metadata",
            },
            {
              id: "compact",
              label: "Compact",
              description: "Inline chip with label only",
            },
          ].map(({ id, label, description }) => (
            <button
              key={id}
              type="button"
              disabled={saving}
              className={cn(
                "flex flex-col items-stretch gap-3 p-4 rounded-lg border-2 transition-colors text-left",
                appearance.mentionDisplay === id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 bg-card",
              )}
              onClick={() => handleMentionDisplayChange(id)}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-foreground">{label}</div>
                  <div className="text-xs text-muted-foreground">{description}</div>
                </div>
                {appearance.mentionDisplay === id && (
                  <Check size={18} weight="bold" className="text-primary shrink-0" />
                )}
              </div>

              <div className="rounded-md border border-border/50 bg-muted/40 p-3">
                {id === "expanded" ? <MentionPreviewExpanded /> : <MentionPreviewCompact />}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Accent Color</h2>
          <p className="text-sm text-muted-foreground">Pick a color that represents you.</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <input
              type="color"
              value={appearance.accentColor ? hslToHex(appearance.accentColor) : "#684aff"}
              onChange={(e) => handleAccentColorChange(hexToHsl(e.target.value))}
              disabled={saving}
              className="w-16 h-16 rounded-xl cursor-pointer bg-transparent p-1 transition-colors"
              title="Choose custom color"
            />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground mb-1">Custom Color</p>
            <p className="text-xs text-muted-foreground">
              Click to open the color picker, or choose a preset below.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={saving || !appearance.accentColor}
            onClick={() => handleAccentColorChange(undefined)}
          >
            Reset
          </Button>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-2">Quick picks</p>
          <div className="flex flex-wrap gap-2">
            {ACCENT_COLORS.map(({ name, value }) => (
              <button
                key={value}
                type="button"
                disabled={saving}
                className={`relative w-8 h-8 rounded-full transition-all ${
                  appearance.accentColor === value ? "scale-110" : "hover:scale-105"
                }`}
                style={{ backgroundColor: `hsl(${value})` }}
                title={name}
                onClick={() => handleAccentColorChange(value)}
              >
                {appearance.accentColor === value && (
                  <Check size={16} weight="bold" className="absolute inset-0 m-auto text-white" />
                )}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Font</h2>
          <p className="text-sm text-muted-foreground">Choose the typeface for the interface.</p>
        </div>

        <div className="space-y-2">
          {FONT_FAMILIES.map(({ id, name, description, stack }) => (
            <button
              key={id}
              type="button"
              disabled={saving}
              className={`flex items-center justify-between w-full gap-4 p-4 rounded-lg border transition-colors ${
                appearance.fontFamily === id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 bg-card"
              }`}
              onClick={() => handleFontFamilyChange(id)}
              style={{ fontFamily: stack }}
            >
              <div className="flex items-center gap-4 min-w-0 text-left">
                <span
                  className="text-3xl font-semibold text-foreground shrink-0 w-12 text-center"
                  aria-hidden="true"
                >
                  Ag
                </span>
                <div className="min-w-0">
                  <div className="font-medium text-foreground">{name}</div>
                  <div className="text-sm text-muted-foreground">{description}</div>
                  <div className="text-sm text-muted-foreground/80 truncate">
                    The quick brown fox jumps over the lazy dog 0123456789
                  </div>
                </div>
              </div>
              {appearance.fontFamily === id && (
                <Check size={20} weight="bold" className="text-primary shrink-0" />
              )}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Notes</h2>
          <p className="text-sm text-muted-foreground">
            Configure the default editor for your notes.
          </p>
        </div>

        <div className="space-y-2">
          {EDITOR_OPTIONS.map(({ id, name, description }) => {
            const isSelected = appearance.defaultEditor === id;
            return (
              <div key={id} className="space-y-2">
                <button
                  type="button"
                  disabled={saving}
                  className={`flex items-center justify-between w-full p-4 rounded-lg border transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50 bg-card"
                  }`}
                  onClick={() => handleDefaultEditorChange(id)}
                >
                  <div className="text-left">
                    <div className="font-medium text-foreground">{name}</div>
                    <div className="text-sm text-muted-foreground">{description}</div>
                  </div>
                  {isSelected && <Check size={20} weight="bold" className="text-primary" />}
                </button>
                {id === "markdown" && isSelected && (
                  <div className="ml-4 pl-4 border-l border-border space-y-2">
                    <div className="flex items-center justify-between gap-3 p-3 rounded-md bg-muted/40">
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          Show preview by default
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Open Markdown notes with the live preview pane visible.
                        </div>
                      </div>
                      <ToggleSwitch
                        enabled={appearance.markdownShowPreview}
                        onChange={handleMarkdownShowPreviewChange}
                        disabled={saving}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 p-3 rounded-md bg-muted/40">
                      <div>
                        <div className="text-sm font-medium text-foreground">Show line numbers</div>
                        <div className="text-xs text-muted-foreground">
                          Display line numbers in the Markdown editor gutter.
                        </div>
                      </div>
                      <ToggleSwitch
                        enabled={appearance.markdownShowLineNumbers}
                        onChange={handleMarkdownShowLineNumbersChange}
                        disabled={saving}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function MentionPreviewExpanded() {
  return (
    <div className="inline-flex flex-col gap-1.5 max-w-full rounded-md border border-rose-500/40 bg-gradient-to-r from-rose-500/10 to-rose-500/5 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="flex items-center justify-center w-6 h-6 rounded-md bg-rose-500 text-white shrink-0">
          <CalendarBlank size={14} weight="duotone" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground truncate">Q2 Planning Sync</div>
          <div className="text-[11px] text-muted-foreground">
            Calendar event . Tomorrow, 10:00 AM
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <CheckSquare size={12} weight="duotone" className="text-emerald-500" />
        <span>3 of 5 tasks ready</span>
        <span className="text-muted-foreground/40">.</span>
        <ArrowSquareOut size={11} className="text-muted-foreground/70" />
        <span className="text-muted-foreground/70">Open</span>
      </div>
    </div>
  );
}

function MentionPreviewCompact() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-gradient-to-r from-rose-500/10 to-rose-500/5 px-1.5 py-0.5">
      <span className="flex items-center justify-center w-3.5 h-3.5 rounded-sm bg-rose-500 shrink-0">
        <CalendarBlank size={9} weight="duotone" className="text-white" />
      </span>
      <span className="text-xs font-medium text-foreground">Q2 Planning Sync</span>
    </span>
  );
}
