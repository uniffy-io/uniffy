import { cn } from '@/utils/cn';
import { useState } from 'react';

interface AccentColorPickerProps {
  currentColor: string | null;
  onColorChange: (color: string) => void;
}

// Predefined accent colors in HSL format
const ACCENT_COLORS = [
  { name: 'Blue', hsl: '221.2 83.2% 53.3%' },
  { name: 'Purple', hsl: '270 95% 65%' },
  { name: 'Pink', hsl: '330 85% 60%' },
  { name: 'Red', hsl: '0 84% 60%' },
  { name: 'Orange', hsl: '25 95% 53%' },
  { name: 'Yellow', hsl: '48 96% 53%' },
  { name: 'Green', hsl: '142 71% 45%' },
  { name: 'Teal', hsl: '173 80% 40%' },
  { name: 'Cyan', hsl: '199 89% 48%' },
  { name: 'Indigo', hsl: '239 84% 67%' },
];

// Convert HSL string to hex color
function hslToHex(hslString: string): string {
  const parts = hslString.match(/(\d+(?:\.\d+)?)/g);
  if (!parts || parts.length !== 3) return '#3b82f6';
  
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

// Convert hex color to HSL string
function hexToHsl(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '221.2 83.2% 53.3%';
  
  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  
  h = Math.round(h * 360 * 10) / 10;
  s = Math.round(s * 100 * 10) / 10;
  l = Math.round(l * 100 * 10) / 10;
  
  return `${h} ${s}% ${l}%`;
}

export function AccentColorPicker({ currentColor, onColorChange }: AccentColorPickerProps) {
  const [customColor, setCustomColor] = useState(
    currentColor ? hslToHex(currentColor) : '#3b82f6'
  );

  const handleColorClick = (hsl: string) => {
    onColorChange(hsl);
    setCustomColor(hslToHex(hsl));
  };

  const handleCustomColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value;
    setCustomColor(hex);
    const hsl = hexToHsl(hex);
    onColorChange(hsl);
  };

  const handleReset = () => {
    onColorChange('');
    setCustomColor('#3b82f6');
  };

  const isPresetColor = ACCENT_COLORS.some(color => color.hsl === currentColor);

  return (
    <div>
      <div className="mb-3">
        <label className="block text-sm font-semibold text-foreground mb-1">
          Accent Color
        </label>
        <p className="text-xs text-muted-foreground">
          Choose a preset or pick your own custom color
        </p>
      </div>

      {/* Custom Color Picker */}
      <div className="mb-4 flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
        <div className="relative">
          <input
            type="color"
            value={customColor}
            onChange={handleCustomColorChange}
            className="h-12 w-12 rounded-lg cursor-pointer border-2 border-border"
            style={{ padding: '2px' }}
          />
          <div 
            className="absolute inset-0 rounded-lg pointer-events-none border-2 border-transparent"
            style={{ 
              borderColor: !isPresetColor && currentColor ? 'hsl(var(--foreground))' : 'transparent',
            }}
          />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Custom Color</p>
          <p className="text-xs text-muted-foreground mt-0.5">Click to choose any color</p>
        </div>
      </div>

      {/* Preset Colors */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Quick Presets</p>
        <div className="grid grid-cols-5 gap-3">
          {ACCENT_COLORS.map((color) => (
            <button
              key={color.name}
              onClick={() => handleColorClick(color.hsl)}
              className={cn(
                'relative h-10 w-full rounded-lg transition-all hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary shadow-sm',
                currentColor === color.hsl && 'ring-2 ring-offset-2 ring-foreground scale-105'
              )}
              style={{ backgroundColor: `hsl(${color.hsl})` }}
              title={color.name}
            >
              {currentColor === color.hsl && (
                <span className="absolute inset-0 flex items-center justify-center text-white text-sm font-bold drop-shadow-lg">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {currentColor && (
        <button
          onClick={handleReset}
          className="mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          Reset to default
        </button>
      )}
    </div>
  );
}
