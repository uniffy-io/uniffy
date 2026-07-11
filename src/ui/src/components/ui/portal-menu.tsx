/** Renders into `document.body` to escape ancestor `overflow: hidden` containers (e.g. Table). */
import {
    type ReactNode,
    type RefObject,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/shared/utils/cn';

interface MenuPosition {
    top: number;
    left: number;
    minWidth: number;
    /** False until the menu has been measured and flipped/clamped to fit the viewport. */
    ready: boolean;
}

interface PortalMenuProps {
    open: boolean;
    onClose: () => void;
    triggerRef: RefObject<HTMLElement | null>;
    children: ReactNode;
    /** Horizontal alignment relative to the trigger. Default: 'right'. */
    align?: 'left' | 'right';
    /** Menu width. Default: 'w-52'. */
    className?: string;
}

const MENU_WIDTH = 208;
const VIEWPORT_MARGIN = 8;

export function PortalMenu({
    open,
    onClose,
    triggerRef,
    children,
    align = 'right',
    className = 'w-52',
}: PortalMenuProps) {
    const menuRef = useRef<HTMLDivElement | null>(null);
    const [position, setPosition] = useState<MenuPosition | null>(null);

    useLayoutEffect(() => {
        // A closed menu renders null (see the guard below), so no reset is needed here;
        // reopening recomputes a fresh position with ready=false before the next paint.
        if (!open) return;
        const trigger = triggerRef.current;
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        const left =
            align === 'right'
                ? Math.max(VIEWPORT_MARGIN, rect.right - MENU_WIDTH)
                : Math.max(VIEWPORT_MARGIN, rect.left);
        setPosition({ top: rect.bottom + 4, left, minWidth: MENU_WIDTH, ready: false });
    }, [open, triggerRef, align]);

    // Once the menu is in the DOM, measure it and flip above the trigger (or clamp)
    // when it would overflow the viewport bottom - otherwise a trigger low on the
    // screen opens its menu off-screen where it reads as "nothing happened".
    useLayoutEffect(() => {
        if (!open || !position || position.ready) return;
        const trigger = triggerRef.current;
        const menu = menuRef.current;
        if (!trigger || !menu) return;
        const rect = trigger.getBoundingClientRect();
        const menuHeight = menu.offsetHeight;
        const menuWidth = menu.offsetWidth;
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        let top: number;
        if (spaceBelow < menuHeight + VIEWPORT_MARGIN && spaceAbove > spaceBelow) {
            top = Math.max(VIEWPORT_MARGIN, rect.top - menuHeight - 4);
        } else {
            top = Math.max(
                VIEWPORT_MARGIN,
                Math.min(rect.bottom + 4, window.innerHeight - menuHeight - VIEWPORT_MARGIN),
            );
        }
        // Re-anchor horizontally against the measured width (className may widen the
        // menu past MENU_WIDTH) and clamp so it never spills off the right edge.
        const rawLeft = align === 'right' ? rect.right - menuWidth : rect.left;
        const left = Math.max(
            VIEWPORT_MARGIN,
            Math.min(rawLeft, window.innerWidth - menuWidth - VIEWPORT_MARGIN),
        );
        setPosition((p) => (p ? { ...p, top, left, ready: true } : p));
    }, [open, position, triggerRef, align]);

    useEffect(() => {
        if (!open) return;
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as Node;
            if (menuRef.current?.contains(target)) return;
            if (triggerRef.current?.contains(target)) return;
            onClose();
        }
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') onClose();
        }
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open, onClose, triggerRef]);

    if (!open || !position) return null;

    return createPortal(
        <div
            ref={menuRef}
            style={{
                position: 'fixed',
                top: position.top,
                left: position.left,
                minWidth: position.minWidth,
                visibility: position.ready ? 'visible' : 'hidden',
            }}
            className={cn(
                'z-[200] rounded-lg border border-border bg-card shadow-lg py-1 text-sm',
                className,
            )}
        >
            {children}
        </div>,
        document.body,
    );
}
