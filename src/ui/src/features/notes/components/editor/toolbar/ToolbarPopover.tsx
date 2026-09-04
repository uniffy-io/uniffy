import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { popoverShellClass } from "@/components/ui/popover";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { cn } from "@/shared/utils/cn";

interface ToolbarPopoverProps {
  trigger: (props: {
    open: boolean;
    onClick: () => void;
    ref: React.RefObject<HTMLButtonElement | null>;
  }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  className?: string;
}

export function ToolbarPopover({
  trigger,
  children,
  align = "start",
  className,
}: ToolbarPopoverProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  useOverlayEscape(() => setOpen(false), open);

  const toggle = () => {
    if (!open && triggerRef.current) {
      setRect(triggerRef.current.getBoundingClientRect());
    }
    setOpen((v) => !v);
  };

  const close = () => setOpen(false);

  return (
    <>
      {trigger({ open, onClick: toggle, ref: triggerRef })}
      {open &&
        rect &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            style={{
              position: "fixed",
              top: rect.bottom + 4,
              left: align === "start" ? rect.left : undefined,
              right: align === "end" ? window.innerWidth - rect.right : undefined,
              zIndex: 1000,
            }}
            className={cn(popoverShellClass, "min-w-[180px] p-1", className)}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}
