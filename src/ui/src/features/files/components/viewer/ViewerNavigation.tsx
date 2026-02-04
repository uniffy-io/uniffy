/**
 * Viewer Navigation
 *
 * Previous/Next navigation arrows for playlist navigation.
 * Uses glassmorphism design with smooth hover effects.
 */

import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useFormattedKeybinding } from '@/features/settings';

interface ViewerNavigationProps {
    direction: 'prev' | 'next';
    onClick: () => void;
}

export function ViewerNavigation({ direction, onClick }: ViewerNavigationProps) {
    const prevShortcut = useFormattedKeybinding('viewer.previous');
    const nextShortcut = useFormattedKeybinding('viewer.next');

    const isPrev = direction === 'prev';

    return (
        <button
            onClick={onClick}
            className={`viewer-nav-btn ${isPrev ? 'left' : 'right'}`}
            title={isPrev ? `Previous (${prevShortcut})` : `Next (${nextShortcut})`}
        >
            {isPrev ? (
                <CaretLeft size={28} weight="bold" />
            ) : (
                <CaretRight size={28} weight="bold" />
            )}
        </button>
    );
}
