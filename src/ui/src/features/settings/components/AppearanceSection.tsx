import { Sun, Moon, Desktop, Check } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { controlShellClass } from "@/components/ui/input";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { TimezoneSelect } from "@/components/ui/timezone-select";
import { cn } from "@/shared/utils/cn";
import {
  useSettings,
  useAppearanceSettings,
  useSchedulingSettings,
} from "@/features/settings/hooks/useSettings";
import { ACCENT_COLORS, hexToHsl, hslToHex } from "@/config/theme/accentColors";
import { MentionDisplayPicker } from "@/features/settings/components/MentionDisplayPicker";

const WORKDAY_OPTIONS = [
  { id: "monday", label: "Mon" },
  { id: "tuesday", label: "Tue" },
  { id: "wednesday", label: "Wed" },
  { id: "thursday", label: "Thu" },
  { id: "friday", label: "Fri" },
  { id: "saturday", label: "Sat" },
  { id: "sunday", label: "Sun" },
];

const CLOCK_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hours = Math.floor(i / 2);
  const minutes = i % 2 === 0 ? "00" : "30";
  return `${String(hours).padStart(2, "0")}:${minutes}`;
});

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
  const scheduling = useSchedulingSettings();

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

  const handleWorkdayHoursChange = (workdayStart: string, workdayEnd: string) => {
    if (workdayStart < workdayEnd) {
      updateSettings({ scheduling: { workdayStart, workdayEnd } });
    }
  };

  const handleWorkdayToggle = (day: string) => {
    const next = scheduling.workdays.includes(day)
      ? scheduling.workdays.filter((d) => d !== day)
      : WORKDAY_OPTIONS.map((o) => o.id).filter(
          (d) => scheduling.workdays.includes(d) || d === day,
        );
    if (next.length > 0) {
      updateSettings({ scheduling: { workdays: next } });
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground mb-2">Appearance</h1>
        <p className="text-muted-foreground">Customize the look and feel of your Uniffy.</p>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Theme</h2>
          <p className="text-sm font-medium text-muted-foreground">
            Choose how the interface looks.
          </p>
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
              className={`flex flex-col items-center gap-2 p-3 md:p-4 rounded-xl transition-shadow duration-150 ${
                appearance.theme === id
                  ? "bg-primary/5 shadow-edge-primary"
                  : "bg-surface shadow-edge hover:shadow-edge-strong"
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
          <p className="text-sm font-medium text-muted-foreground">
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
          <h2 className="text-lg font-semibold text-foreground">Working hours</h2>
          <p className="text-sm font-medium text-muted-foreground">
            Meeting suggestions and availability answers stay inside these hours, on your own clock.
          </p>
        </div>

        <div className="flex max-w-2xl flex-col gap-4 md:flex-row md:items-end">
          <div className="flex shrink-0 items-end gap-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">From</label>
              <select
                value={scheduling.workdayStart}
                disabled={saving}
                onChange={(e) => handleWorkdayHoursChange(e.target.value, scheduling.workdayEnd)}
                className={cn(controlShellClass, "focus-ring h-10 px-3 text-sm text-foreground")}
                aria-label="Workday start"
              >
                {CLOCK_OPTIONS.map((value) => (
                  <option key={value} value={value} disabled={value >= scheduling.workdayEnd}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">To</label>
              <select
                value={scheduling.workdayEnd}
                disabled={saving}
                onChange={(e) => handleWorkdayHoursChange(scheduling.workdayStart, e.target.value)}
                className={cn(controlShellClass, "focus-ring h-10 px-3 text-sm text-foreground")}
                aria-label="Workday end"
              >
                {CLOCK_OPTIONS.map((value) => (
                  <option key={value} value={value} disabled={value <= scheduling.workdayStart}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="min-w-0 space-y-1.5">
            <label className="text-sm font-medium text-foreground">Workdays</label>
            <div className="flex flex-wrap gap-2">
              {WORKDAY_OPTIONS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  disabled={saving}
                  onClick={() => handleWorkdayToggle(id)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                    scheduling.workdays.includes(id)
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
          <p className="text-sm font-medium text-muted-foreground">
            Choose how mentions appear in chat, notes, and other content.
          </p>
        </div>

        <MentionDisplayPicker
          value={appearance.mentionDisplay === "compact" ? "compact" : "expanded"}
          onChange={handleMentionDisplayChange}
          disabled={saving}
        />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Accent Color</h2>
          <p className="text-sm font-medium text-muted-foreground">
            Pick a color that represents you.
          </p>
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
            <p className="text-xs font-medium text-muted-foreground">
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
          <p className="text-xs font-medium text-muted-foreground mb-2">Quick picks</p>
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
          <p className="text-sm font-medium text-muted-foreground">
            Choose the typeface for the interface.
          </p>
        </div>

        <div className="space-y-2">
          {FONT_FAMILIES.map(({ id, name, description, stack }) => (
            <button
              key={id}
              type="button"
              disabled={saving}
              className={`flex items-center justify-between w-full gap-4 p-4 rounded-xl transition-shadow duration-150 ${
                appearance.fontFamily === id
                  ? "bg-primary/5 shadow-edge-primary"
                  : "bg-surface shadow-edge hover:shadow-edge-strong"
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
                  <div className="text-sm font-medium text-muted-foreground">{description}</div>
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
          <p className="text-sm font-medium text-muted-foreground">
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
                  className={`flex items-center justify-between w-full p-4 rounded-xl transition-shadow duration-150 ${
                    isSelected
                      ? "bg-primary/5 shadow-edge-primary"
                      : "bg-surface shadow-edge hover:shadow-edge-strong"
                  }`}
                  onClick={() => handleDefaultEditorChange(id)}
                >
                  <div className="text-left">
                    <div className="font-medium text-foreground">{name}</div>
                    <div className="text-sm font-medium text-muted-foreground">{description}</div>
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
                        <div className="text-xs font-medium text-muted-foreground">
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
                        <div className="text-xs font-medium text-muted-foreground">
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
