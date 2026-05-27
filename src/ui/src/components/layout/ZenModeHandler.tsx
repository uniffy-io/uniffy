import { useCallback } from 'react';
import { useAppDispatch } from '@/app/hooks';
import { toggleZenMode } from '@/app/zenModeSlice';
import { useShortcutHandler } from '@/features/settings';

/** Renders nothing — just registers the global Zen Mode shortcut. */
export function ZenModeHandler() {
    const dispatch = useAppDispatch();

    const handleToggle = useCallback(() => {
        dispatch(toggleZenMode());
    }, [dispatch]);

    useShortcutHandler('app.zenMode', handleToggle);

    return null;
}
