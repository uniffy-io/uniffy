import { useEffect, useCallback } from 'react';

const SPOTLIGHT_OPEN_EVENT = 'uniffy:spotlight:open';

/** Window-event bridge so editor plugins and other non-React code can open spotlight. */
export function openSpotlightSearch(): void {
    window.dispatchEvent(new CustomEvent(SPOTLIGHT_OPEN_EVENT));
}

export function useSpotlightOpenListener(onOpen: () => void): void {
    useEffect(() => {
        const handler = () => onOpen();
        window.addEventListener(SPOTLIGHT_OPEN_EVENT, handler);
        return () => window.removeEventListener(SPOTLIGHT_OPEN_EVENT, handler);
    }, [onOpen]);
}

export function useOpenSpotlight(): () => void {
    return useCallback(() => {
        openSpotlightSearch();
    }, []);
}
