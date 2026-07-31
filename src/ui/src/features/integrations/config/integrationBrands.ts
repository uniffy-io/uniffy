import { GithubLogo } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

/**
 * Integration marks are the trademarks of their owners, rendered from the
 * bundled phosphor set to identify which external service a connection talks
 * to. Keys match the backend integration provider ids.
 */
const INTEGRATION_BRANDS: Record<string, { label: string; icon: Icon }> = {
    github: { label: 'GitHub', icon: GithubLogo },
};

/** Icon for a provider id; callers fall back to the Plugs icon when null. */
export function integrationBrand(id: string | undefined): Icon | null {
    if (!id) return null;
    return INTEGRATION_BRANDS[id.toLowerCase()]?.icon ?? null;
}

export function integrationLabel(id: string | undefined): string {
    if (!id) return '';
    return INTEGRATION_BRANDS[id.toLowerCase()]?.label ?? id;
}
