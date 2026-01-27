import { useCallback } from 'react';
import { useAppDispatch } from '@/app/hooks';
import { toggleZenMode } from '@/app/zenModeSlice';
import { useShortcutHandler } from '@/features/settings';

/**
 * Global handler for Zen Mode keyboard shortcut.
 * Renders nothing — just registers the shortcut listener.
 */
export function ZenModeHandler() {
    const dispatch = useAppDispatch();

    const handleToggle = useCallback(() => {
        dispatch(toggleZenMode());
    }, [dispatch]);

    useShortcutHandler('app.zenMode', handleToggle);

    return null;
}
