import { createElement } from 'react';
import { ArrowSquareOut, BookOpen, Plugs } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { integrationBrand } from '@/features/integrations/config/integrationBrands';
import type { IntegrationProviderPlain } from '@/features/integrations/store/integrationsThunks';

interface IntegrationProviderPickerProps {
    /** The backend registry is the list; a provider it does not serve cannot be connected. */
    providers: IntegrationProviderPlain[];
    value: string;
    onChange: (provider: string) => void;
    className?: string;
}

/** Host only, so the link text reads as the place the user goes rather than a full URL. */
function linkHost(url: string): string {
    return new URL(url).host.replace(/^www\./, '');
}

/**
 * Service choice for the add-connection form: a mark per service plus the path
 * to where that service mints tokens, since a credential nobody can find is the
 * thing that blocks every agent tool behind it.
 */
export function IntegrationProviderPicker({
    providers,
    value,
    onChange,
    className,
}: IntegrationProviderPickerProps) {
    const descriptor = providers.find((p) => p.id === value) ?? null;
    const brand = integrationBrand(value);

    return (
        <div className={cn('space-y-3', className)}>
            <div
                role="radiogroup"
                aria-label="Service"
                className="grid grid-cols-2 sm:grid-cols-3 gap-2"
            >
                {providers.map((provider) => {
                    const isSelected = provider.id === value;
                    const icon = integrationBrand(provider.id)?.icon ?? Plugs;
                    return (
                        <button
                            key={provider.id}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            onClick={() => onChange(provider.id)}
                            className={cn(
                                'flex items-center gap-2.5 rounded-lg border px-3 py-3 text-left transition-colors',
                                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background',
                                isSelected
                                    ? 'border-primary bg-primary/10 text-foreground'
                                    : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                            )}
                        >
                            {createElement(icon, { size: 20, className: 'shrink-0' })}
                            <span className="text-sm font-medium truncate">
                                {provider.label}
                            </span>
                        </button>
                    );
                })}
            </div>

            {brand && (
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex items-center gap-2">
                        <BookOpen size={16} className="text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium text-foreground">
                            How to get a {brand.label} token
                        </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {brand.credentialHelp}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <a
                            href={brand.consoleUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                            Create a token on {linkHost(brand.consoleUrl)}
                            <ArrowSquareOut size={12} weight="bold" />
                        </a>
                        {descriptor?.credentialDocsUrl && (
                            <a
                                href={descriptor.credentialDocsUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                            >
                                Token documentation
                                <ArrowSquareOut size={12} weight="bold" />
                            </a>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
