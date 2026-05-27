/**
 * PortalMenu - dropdown rendered into document.body so it escapes
 * ancestor ``overflow: hidden`` containers (e.g. ``Table`` wrapper).
 *
 * Anchors to a trigger ref via getBoundingClientRect. Right-aligns to
 * the trigger's right edge by default; can override via the ``align``
 * prop. Closes on outside click + Escape.
 */

import {
    type ReactNode,
    type RefObject,
    useEffect,
    useRef,
    useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/shared/utils/cn';

interface MenuPosition {
    top: number;
    left: number;
    minWidth: number;
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

    useEffect(() => {
        if (!open) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing position on close prevents stale anchor on next open
            setPosition(null);
            return;
        }
        const trigger = triggerRef.current;
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        const menuWidth = 208;
        const left =
            align === 'right'
                ? Math.max(8, rect.right - menuWidth)
                : Math.max(8, rect.left);
        setPosition({
            top: rect.bottom + 4,
            left,
            minWidth: menuWidth,
        });
    }, [open, triggerRef, align]);

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
