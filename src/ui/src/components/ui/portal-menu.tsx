/** Renders into `document.body` to escape ancestor `overflow: hidden` containers (e.g. Table). */
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { createPortal } from "react-dom";
import { cn } from "@/shared/utils/cn";
import { popoverShellClass } from "@/components/ui/popover";

interface MenuPosition {
  top: number;
  left: number;
  minWidth: number;
  /** False until the menu has been measured and flipped/clamped to fit the viewport. */
  ready: boolean;
}

export type MenuAnchor =
  | { triggerRef: RefObject<HTMLElement | null>; position?: never }
  | { position: { x: number; y: number }; triggerRef?: RefObject<HTMLElement | null> };

type PortalMenuProps = MenuAnchor & {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Horizontal alignment relative to the trigger. Default: 'right'. */
  align?: "left" | "right";
  /** Menu width. Default: 'w-52'. */
  className?: string;
};

const MENU_WIDTH = 208;
const VIEWPORT_MARGIN = 8;

export function PortalMenu({
  open,
  onClose,
  triggerRef,
  position: anchorPoint,
  children,
  align = "right",
  className = "w-52",
}: PortalMenuProps) {
  const anchorX = anchorPoint?.x;
  const anchorY = anchorPoint?.y;
  const isPointAnchor = anchorPoint !== undefined;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  useLayoutEffect(() => {
    // A closed menu renders null (see the guard below), so no reset is needed here;
    // reopening recomputes a fresh position with ready=false before the next paint.
    if (!open) return;
    const trigger = triggerRef?.current;
    if (!trigger && !isPointAnchor) return;
    const rect = trigger?.getBoundingClientRect();
    const left = anchorX ?? (align === "right" ? rect!.right - MENU_WIDTH : rect!.left);
    setPosition({
      top: anchorY ?? rect!.bottom + 4,
      left,
      minWidth: MENU_WIDTH,
      ready: false,
    });
  }, [open, triggerRef, align, anchorX, anchorY, isPointAnchor]);

  const hasPosition = position !== null;

  useLayoutEffect(() => {
    if (!open || !hasPosition) return;
    const trigger = triggerRef?.current;
    const menu = menuRef.current;
    if ((!trigger && !isPointAnchor) || !menu) return;
    const measure = () => {
      const rect = trigger?.getBoundingClientRect();
      const menuHeight = menu.offsetHeight;
      const menuWidth = menu.offsetWidth;
      const bottom = anchorY ?? rect!.bottom;
      const topEdge = anchorY ?? rect!.top;
      const gap = isPointAnchor ? 0 : 4;
      const spaceBelow = window.innerHeight - bottom;
      const spaceAbove = topEdge;
      let top: number;
      if (spaceBelow < menuHeight + VIEWPORT_MARGIN && spaceAbove > spaceBelow) {
        top = Math.max(VIEWPORT_MARGIN, topEdge - menuHeight - gap);
      } else {
        top = Math.max(
          VIEWPORT_MARGIN,
          Math.min(bottom + gap, window.innerHeight - menuHeight - VIEWPORT_MARGIN),
        );
      }
      // Re-anchor horizontally against the measured width (className may widen the
      // menu past MENU_WIDTH) and clamp so it never spills off the right edge.
      const rawLeft = anchorX ?? (align === "right" ? rect!.right - menuWidth : rect!.left);
      const left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(rawLeft, window.innerWidth - menuWidth - VIEWPORT_MARGIN),
      );
      setPosition((p) =>
        p && (!p.ready || p.top !== top || p.left !== left) ? { ...p, top, left, ready: true } : p,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(menu);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, hasPosition, triggerRef, align, anchorX, anchorY, isPointAnchor]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef?.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onClose, triggerRef]);

  useOverlayEscape(onClose, open);

  if (!open || !position) return null;

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        minWidth: position.minWidth,
        visibility: position.ready ? "visible" : "hidden",
        maxHeight: "calc(100dvh - 16px)",
        maxWidth: "calc(100vw - 16px)",
      }}
      className={cn(popoverShellClass, "z-[200] overflow-y-auto py-1 text-sm", className)}
    >
      {children}
    </div>,
    document.body,
  );
}
