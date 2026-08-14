import { ArrowSquareOut, BookOpen } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { ProviderLogo } from "@/features/agents/components/ProviderLogo";
import { PROVIDER_BRAND_LIST, providerBrand } from "@/features/agents/config/providerBrands";

interface ProviderPickerProps {
  value: string;
  onChange: (provider: string) => void;
  className?: string;
}

/** Host only, so the link text reads as the place the user goes rather than a full URL. */
function linkHost(url: string): string {
  return new URL(url).host.replace(/^www\./, "");
}

/**
 * Provider choice for the add-key form: a mark per provider plus the path to
 * that provider's own key page, since a key nobody can find is the thing that
 * blocks every agent in the org.
 */
export function ProviderPicker({ value, onChange, className }: ProviderPickerProps) {
  const brand = providerBrand(value);

  return (
    <div className={cn("space-y-3", className)}>
      <div
        role="radiogroup"
        aria-label="Provider"
        className="grid grid-cols-2 sm:grid-cols-3 gap-2"
      >
        {PROVIDER_BRAND_LIST.map((entry) => {
          const isSelected = entry.id === value;
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChange(entry.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border px-3 py-3 text-left transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background",
                isSelected
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <ProviderLogo provider={entry.id} size="lg" />
              <span className="text-sm font-medium truncate">{entry.label}</span>
            </button>
          );
        })}
      </div>

      {brand && (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-muted-foreground shrink-0" />
            <span className="text-sm font-medium text-foreground">
              How to get an {brand.label} key
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{brand.credentialHelp}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <a
              href={brand.consoleUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Create a key on {linkHost(brand.consoleUrl)}
              <ArrowSquareOut size={12} weight="bold" />
            </a>
            <a
              href={brand.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              API documentation
              <ArrowSquareOut size={12} weight="bold" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
