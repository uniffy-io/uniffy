import { cn } from "@/shared/utils/cn";
import { providerBrand } from "@/features/agents/config/providerBrands";

type LogoSize = "xs" | "sm" | "md" | "lg";

const SIZE_CLASSES: Record<LogoSize, string> = {
    xs: "w-3 h-3",
    sm: "w-3.5 h-3.5",
    md: "w-4 h-4",
    lg: "w-5 h-5",
};

interface ProviderLogoProps {
    provider: string | undefined;
    size?: LogoSize;
    className?: string;
}

export function ProviderLogo({ provider, size = "md", className }: ProviderLogoProps) {
    const brand = providerBrand(provider);
    if (!brand) return null;

    const sizeClass = SIZE_CLASSES[size];

    if (brand.tone === "color") {
        return (
            <img
                src={brand.iconUrl}
                alt={brand.label}
                title={brand.label}
                className={cn("shrink-0 object-contain", sizeClass, className)}
                data-testid="provider-logo"
                data-provider={provider}
            />
        );
    }

    // Masked rather than an <img>: these marks ship black with fill="currentColor",
    // and an <img> renders in its own document, so it cannot inherit the page's
    // text color and would go invisible on the dark theme.
    return (
        <span
            role="img"
            aria-label={brand.label}
            title={brand.label}
            className={cn("inline-block shrink-0 bg-current", sizeClass, className)}
            style={{
                maskImage: `url("${brand.iconUrl}")`,
                WebkitMaskImage: `url("${brand.iconUrl}")`,
                maskSize: "contain",
                WebkitMaskSize: "contain",
                maskRepeat: "no-repeat",
                WebkitMaskRepeat: "no-repeat",
                maskPosition: "center",
                WebkitMaskPosition: "center",
            }}
            data-testid="provider-logo"
            data-provider={provider}
        />
    );
}
