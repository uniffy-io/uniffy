/**
 * Hook and utilities to trigger the Spotlight search from anywhere.
 *
 * This is useful for triggering search from within editors or other
 * contexts where keyboard shortcuts don't work (e.g., contenteditable).
 */

import { useEffect, useCallback } from 'react';

/** Custom event name for opening spotlight */
const SPOTLIGHT_OPEN_EVENT = 'uwos:spotlight:open';

/**
 * Open the Spotlight search programmatically.
 * Can be called from anywhere - React components, editor plugins, etc.
 */
export function openSpotlightSearch(): void {
    window.dispatchEvent(new CustomEvent(SPOTLIGHT_OPEN_EVENT));
}

/**
 * Hook to listen for spotlight open events.
 * Used internally by SpotlightSearch component.
 */
export function useSpotlightOpenListener(onOpen: () => void): void {
    useEffect(() => {
        const handler = () => onOpen();
        window.addEventListener(SPOTLIGHT_OPEN_EVENT, handler);
        return () => window.removeEventListener(SPOTLIGHT_OPEN_EVENT, handler);
    }, [onOpen]);
}

/**
 * Hook that returns a function to open the Spotlight search.
 * Useful for components that need to trigger search programmatically.
 */
export function useOpenSpotlight(): () => void {
    return useCallback(() => {
        openSpotlightSearch();
    }, []);
}
