import { GithubLogo } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

export interface IntegrationBrand {
    label: string;
    icon: Icon;
    /** Where the service mints credentials. The host is shown as the link text, so it must be the page a signed-in user lands on. */
    consoleUrl: string;
    /** One sentence naming the screen the credential is created on. */
    credentialHelp: string;
}

/**
 * Integration marks are the trademarks of their owners, rendered from the
 * bundled phosphor set to identify which external service a connection talks
 * to. Keys match the backend integration provider ids.
 */
const INTEGRATION_BRANDS: Record<string, IntegrationBrand> = {
    github: {
        label: 'GitHub',
        icon: GithubLogo,
        consoleUrl: 'https://github.com/settings/personal-access-tokens',
        credentialHelp:
            'Sign in to GitHub, then create a fine-grained personal access token with read access to the repositories agents should reach. Enterprise Server has the same page on your own host.',
    },
};

export function integrationBrand(id: string | undefined): IntegrationBrand | null {
    if (!id) return null;
    return INTEGRATION_BRANDS[id.toLowerCase()] ?? null;
}

/** Icon for a provider id; callers fall back to the Plugs icon when null. */
export function integrationIcon(id: string | undefined): Icon | null {
    return integrationBrand(id)?.icon ?? null;
}

export function integrationLabel(id: string | undefined): string {
    if (!id) return '';
    return integrationBrand(id)?.label ?? id;
}
