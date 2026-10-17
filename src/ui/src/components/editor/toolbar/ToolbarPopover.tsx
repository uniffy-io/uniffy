import { useRef, useState, type ReactNode } from "react";
import { PortalMenu } from "@/components/ui/portal-menu";
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
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const toggle = () => {
    setOpen((v) => !v);
  };

  const close = () => setOpen(false);

  return (
    <>
      {trigger({ open, onClick: toggle, ref: triggerRef })}
      <PortalMenu
        open={open}
        onClose={close}
        triggerRef={triggerRef}
        align={align === "start" ? "left" : "right"}
        className={cn("z-[1000] p-1", className)}
      >
        <div role="dialog">{children(close)}</div>
      </PortalMenu>
    </>
  );
}
