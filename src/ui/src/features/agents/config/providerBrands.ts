import anthropicIcon from "@lobehub/icons-static-svg/icons/anthropic.svg?url";
import geminiIcon from "@lobehub/icons-static-svg/icons/gemini-color.svg?url";
import openaiIcon from "@lobehub/icons-static-svg/icons/openai.svg?url";
import openrouterIcon from "@lobehub/icons-static-svg/icons/openrouter.svg?url";
import xaiIcon from "@lobehub/icons-static-svg/icons/xai.svg?url";

export interface ProviderBrand {
    label: string;
    iconUrl: string;
    /**
     * Marks that ship monochrome are tinted to the current text color so they
     * stay legible in both themes - the one-color rendering brand guidelines
     * normally sanction. Marks with their own color identity render untouched.
     */
    tone: "mono" | "color";
}

/**
 * Provider marks are the trademarks of their owners, bundled to identify which
 * service a key talks to. Keys match the catalog's provider ids
 * (`uniffy/data/models/catalog.json`). Dropping a brand is a line edit here.
 */
export const PROVIDER_BRANDS: Record<string, ProviderBrand> = {
    anthropic: { label: "Anthropic", iconUrl: anthropicIcon, tone: "mono" },
    openai: { label: "OpenAI", iconUrl: openaiIcon, tone: "mono" },
    google: { label: "Google Gemini", iconUrl: geminiIcon, tone: "color" },
    openrouter: { label: "OpenRouter", iconUrl: openrouterIcon, tone: "mono" },
    xai: { label: "xAI", iconUrl: xaiIcon, tone: "mono" },
};

export function providerBrand(provider: string | undefined): ProviderBrand | null {
    if (!provider) return null;
    return PROVIDER_BRANDS[provider.toLowerCase()] ?? null;
}

export function providerLabel(provider: string | undefined): string {
    return providerBrand(provider)?.label ?? provider ?? "";
}
