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
  /** Key-shape hint on the credential field. Key shapes change without notice, so this is a hint, never validation. */
  credentialPlaceholder: string;
  /** Where the provider mints API keys. The host is shown as the link text, so it must be the page a signed-in user lands on. */
  consoleUrl: string;
  /** The provider's own API-key / getting-started page. */
  docsUrl: string;
  /** One sentence naming the screen the key is created on. */
  credentialHelp: string;
}

/**
 * Provider marks are the trademarks of their owners, bundled to identify which
 * service a key talks to. Keys match the catalog's provider ids
 * (`uniffy/data/models/catalog.json`). Dropping a brand is a line edit here.
 * This is also the add-key form's provider list, so an entry missing here
 * cannot have a key added at all.
 */
export const PROVIDER_BRANDS: Record<string, ProviderBrand> = {
  anthropic: {
    label: "Anthropic",
    iconUrl: anthropicIcon,
    tone: "mono",
    credentialPlaceholder: "sk-ant-...",
    consoleUrl: "https://platform.claude.com/settings/keys",
    docsUrl: "https://platform.claude.com/docs/en/api/overview",
    credentialHelp: "Sign in to the Claude developer platform, then create a key under API keys.",
  },
  openai: {
    label: "OpenAI",
    iconUrl: openaiIcon,
    tone: "mono",
    credentialPlaceholder: "sk-...",
    consoleUrl: "https://platform.openai.com/api-keys",
    docsUrl: "https://developers.openai.com/api/docs/quickstart",
    credentialHelp: "Sign in to the OpenAI platform, then create a secret key under API keys.",
  },
  google: {
    label: "Google Gemini",
    iconUrl: geminiIcon,
    tone: "color",
    credentialPlaceholder: "AIza...",
    consoleUrl: "https://aistudio.google.com/apikey",
    docsUrl: "https://ai.google.dev/gemini-api/docs/api-key",
    credentialHelp:
      "Sign in to Google AI Studio, then create an API key against a Google Cloud project.",
  },
  openrouter: {
    label: "OpenRouter",
    iconUrl: openrouterIcon,
    tone: "mono",
    credentialPlaceholder: "sk-or-...",
    consoleUrl: "https://openrouter.ai/keys",
    docsUrl: "https://openrouter.ai/docs/api_reference/authentication",
    credentialHelp: "Sign in to OpenRouter, then create a key under your workspace keys.",
  },
  xai: {
    label: "xAI",
    iconUrl: xaiIcon,
    tone: "mono",
    credentialPlaceholder: "xai-...",
    consoleUrl: "https://console.x.ai",
    docsUrl: "https://docs.x.ai/developers/quickstart",
    credentialHelp: "Sign in to the xAI console, then create a key under API keys.",
  },
};

export interface ProviderBrandEntry extends ProviderBrand {
  id: string;
}

/** The brands in declaration order, for surfaces that offer every provider. */
export const PROVIDER_BRAND_LIST: ProviderBrandEntry[] = Object.entries(PROVIDER_BRANDS).map(
  ([id, brand]) => ({ id, ...brand }),
);

export function providerBrand(provider: string | undefined): ProviderBrand | null {
  if (!provider) return null;
  return PROVIDER_BRANDS[provider.toLowerCase()] ?? null;
}

export function providerLabel(provider: string | undefined): string {
  return providerBrand(provider)?.label ?? provider ?? "";
}
