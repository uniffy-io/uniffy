/**
 * Appearance settings section for theme, accent color, and font.
 */

import { Sun, Moon, Desktop, Check, CardsThree, Minus } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { useSettings, useAppearanceSettings } from '@/features/settings/hooks/useSettings';

// Predefined accent colors (quick picks)
const ACCENT_COLORS = [
    { name: 'Blue', value: '217 91% 60%' },
    { name: 'Sky', value: '199 84% 50%' },
    { name: 'Purple', value: '262.1 83.3% 57.8%' },
    { name: 'Green', value: '142.1 76.2% 36.3%' },
    { name: 'Orange', value: '24.6 95% 53.1%' },
    { name: 'Red', value: '0 84.2% 60.2%' },
    { name: 'Pink', value: '330 81% 60%' },
    { name: 'Teal', value: '174 72% 40%' },
    { name: 'Amber', value: '38 92% 50%' },
];

// Convert HSL string to hex for color input
function hslToHex(hsl: string): string {
    const parts = hsl.split(' ');
    if (parts.length !== 3) return '#3c83f5';

    const h = parseFloat(parts[0]) / 360;
    const s = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;

    const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
    };

    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }

    const toHex = (x: number) => {
        const hex = Math.round(x * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Convert hex to HSL string for storage
function hexToHsl(hex: string): string {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return '217 91% 60%';

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
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }

    return `${(h * 360).toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%`;
}

// Font families
const FONT_FAMILIES = [
    { id: 'inter', name: 'Inter', description: 'Clean and modern' },
    { id: 'geist', name: 'Geist', description: 'Vercel style' },
    { id: 'system', name: 'System', description: 'Native OS font' },
];

// Editor mode options for notes
const EDITOR_OPTIONS = [
    { id: 'crepe', name: 'Editor', description: 'Rich WYSIWYG editor with full formatting' },
    { id: 'markdown', name: 'Markdown', description: 'Split view with markdown source and preview' },
    { id: 'readonly', name: 'Read Only', description: 'View-only mode for reading notes' },
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

    const handleMentionDisplayChange = (mentionDisplay: string) => {
        updateSettings({ appearance: { mentionDisplay } });
    };

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-xl md:text-2xl font-bold text-foreground mb-2">Appearance</h1>
                <p className="text-sm text-muted-foreground">
                    Customize the look and feel of your workspace.
                </p>
            </div>

            {/* Theme mode */}
            <section className="space-y-4">
                <div>
                    <h2 className="text-lg font-semibold text-foreground">Theme</h2>
                    <p className="text-sm text-muted-foreground">
                        Choose how the interface looks.
                    </p>
                </div>

                <div className="grid grid-cols-3 gap-2 md:gap-4">
                    {[
                        { id: 'light', label: 'Light', icon: Sun },
                        { id: 'dark', label: 'Dark', icon: Moon },
                        { id: 'system', label: 'System', icon: Desktop },
                    ].map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            type="button"
                            disabled={saving}
                            className={`flex flex-col items-center gap-2 p-3 md:p-4 rounded-lg border-2 transition-colors ${
                                appearance.theme === id
                                    ? 'border-primary bg-primary/5'
                                    : 'border-border hover:border-primary/50 bg-card'
                            }`}
                            onClick={() => handleThemeChange(id)}
                        >
                            <Icon size={32} weight="duotone" className="text-foreground" />
                            <span className="text-sm font-medium text-foreground">{label}</span>
                        </button>
                    ))}
                </div>
            </section>

            {/* Accent color */}
            <section className="space-y-4">
                <div>
                    <h2 className="text-lg font-semibold text-foreground">Accent Color</h2>
                    <p className="text-sm text-muted-foreground">
                        Pick a color that represents you.
                    </p>
                </div>

                {/* Color picker */}
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <input
                            type="color"
                            value={appearance.accentColor ? hslToHex(appearance.accentColor) : '#3c83f5'}
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

                {/* Quick pick presets */}
                <div>
                    <p className="text-xs text-muted-foreground mb-2">Quick picks</p>
                    <div className="flex flex-wrap gap-2">
                        {ACCENT_COLORS.map(({ name, value }) => (
                            <button
                                key={value}
                                type="button"
                                disabled={saving}
                                className={`relative w-8 h-8 rounded-full transition-all ${
                                    appearance.accentColor === value
                                        ? 'scale-110'
                                        : 'hover:scale-105'
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

            {/* Font family */}
            <section className="space-y-4">
                <div>
                    <h2 className="text-lg font-semibold text-foreground">Font</h2>
                    <p className="text-sm text-muted-foreground">
                        Choose the typeface for the interface.
                    </p>
                </div>

                <div className="space-y-2">
                    {FONT_FAMILIES.map(({ id, name, description }) => (
                        <button
                            key={id}
                            type="button"
                            disabled={saving}
                            className={`flex items-center justify-between w-full p-4 rounded-lg border transition-colors ${
                                appearance.fontFamily === id
                                    ? 'border-primary bg-primary/5'
                                    : 'border-border hover:border-primary/50 bg-card'
                            }`}
                            onClick={() => handleFontFamilyChange(id)}
                        >
                            <div className="text-left">
                                <div className="font-medium text-foreground">{name}</div>
                                <div className="text-sm text-muted-foreground">{description}</div>
                            </div>
                            {appearance.fontFamily === id && (
                                <Check size={20} weight="bold" className="text-primary" />
                            )}
                        </button>
                    ))}
                </div>
            </section>

            {/* Notes section */}
            <section className="space-y-4">
                <div>
                    <h2 className="text-lg font-semibold text-foreground">Notes</h2>
                    <p className="text-sm text-muted-foreground">
                        Configure the default editor for your notes.
                    </p>
                </div>

                <div className="space-y-2">
                    {EDITOR_OPTIONS.map(({ id, name, description }) => (
                        <button
                            key={id}
                            type="button"
                            disabled={saving}
                            className={`flex items-center justify-between w-full p-4 rounded-lg border transition-colors ${
                                appearance.defaultEditor === id
                                    ? 'border-primary bg-primary/5'
                                    : 'border-border hover:border-primary/50 bg-card'
                            }`}
                            onClick={() => handleDefaultEditorChange(id)}
                        >
                            <div className="text-left">
                                <div className="font-medium text-foreground">{name}</div>
                                <div className="text-sm text-muted-foreground">{description}</div>
                            </div>
                            {appearance.defaultEditor === id && (
                                <Check size={20} weight="bold" className="text-primary" />
                            )}
                        </button>
                    ))}
                </div>
            </section>

            {/* Mention Display */}
            <section className="space-y-4">
                <div>
                    <h2 className="text-lg font-semibold text-foreground">Mention Display</h2>
                    <p className="text-sm text-muted-foreground">
                        Choose how mentions appear in chat, notes, and other content.
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-2 md:gap-4">
                    {[
                        { id: 'expanded', label: 'Expanded', icon: CardsThree, description: 'Rich card with metadata' },
                        { id: 'compact', label: 'Compact', icon: Minus, description: 'Inline chip with label' },
                    ].map(({ id, label, icon: Icon, description }) => (
                        <button
                            key={id}
                            type="button"
                            disabled={saving}
                            className={`flex flex-col items-center gap-2 p-3 md:p-4 rounded-lg border-2 transition-colors ${
                                appearance.mentionDisplay === id
                                    ? 'border-primary bg-primary/5'
                                    : 'border-border hover:border-primary/50 bg-card'
                            }`}
                            onClick={() => handleMentionDisplayChange(id)}
                        >
                            <Icon size={32} weight="duotone" className="text-foreground" />
                            <span className="text-sm font-medium text-foreground">{label}</span>
                            <span className="text-xs text-muted-foreground text-center">{description}</span>
                        </button>
                    ))}
                </div>
            </section>
        </div>
    );
}

