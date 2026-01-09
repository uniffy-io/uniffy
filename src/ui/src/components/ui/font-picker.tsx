import { cn } from '@/utils/cn';

interface FontPickerProps {
  currentFont: string | null;
  onFontChange: (font: string) => void;
}

const FONT_OPTIONS = [
  {
    id: 'inter',
    name: 'Inter',
    description: 'Modern and highly readable',
    cssClass: 'font-[Inter]',
  },
  {
    id: 'geist',
    name: 'Geist Sans',
    description: 'Clean and contemporary',
    cssClass: 'font-[Geist_Sans]',
  },
  {
    id: 'system',
    name: 'System',
    description: 'Native OS fonts',
    cssClass: 'font-[ui-sans-serif]',
  },
];

export function FontPicker({ currentFont, onFontChange }: FontPickerProps) {
  const selectedFont = currentFont || 'inter'; // Default to Inter

  const handleFontClick = (fontId: string) => {
    onFontChange(fontId);
  };

  const handleReset = () => {
    onFontChange('');
  };

  return (
    <div>
      <div className="mb-3">
        <label className="block text-sm font-semibold text-foreground mb-1">
          Font Family
        </label>
        <p className="text-xs text-muted-foreground">
          Choose a typeface for the interface
        </p>
      </div>

      <div className="space-y-2">
        {FONT_OPTIONS.map((font) => (
          <button
            key={font.id}
            onClick={() => handleFontClick(font.id)}
            className={cn(
              'w-full text-left p-4 rounded-lg border-2 transition-all hover:border-primary/50 hover:bg-muted/50',
              selectedFont === font.id
                ? 'border-primary bg-primary/5'
                : 'border-border bg-transparent'
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className={cn('text-lg font-medium text-foreground mb-1', font.cssClass)}>
                  {font.name}
                </p>
                <p className="text-xs text-muted-foreground">{font.description}</p>
                <p className={cn('text-sm text-foreground mt-2', font.cssClass)}>
                  The quick brown fox jumps over the lazy dog
                </p>
              </div>
              {selectedFont === font.id && (
                <div className="ml-3 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary">
                  <svg
                    className="h-3 w-3 text-primary-foreground"
                    fill="currentColor"
                    viewBox="0 0 12 12"
                  >
                    <path d="M3.707 5.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4a1 1 0 00-1.414-1.414L5 6.586 3.707 5.293z" />
                  </svg>
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      {currentFont && currentFont !== 'inter' && (
        <button
          onClick={handleReset}
          className="mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          Reset to default (Inter)
        </button>
      )}
    </div>
  );
}
