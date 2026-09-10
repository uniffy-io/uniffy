import { useEffect, useRef, type ComponentProps, type ReactNode, type RefObject } from "react";
import { Modal, ModalBody, ModalHeader } from "@/components/ui/modal";
import { PortalMenu, type MenuAnchor } from "@/components/ui/portal-menu";
import { cn } from "@/shared/utils/cn";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";

type ActionMenuProps = MenuAnchor & {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
  align?: "left" | "right";
};

function ActionMenuContent({
  children,
  label,
  triggerRef,
  onClose,
}: {
  children: ReactNode;
  label: string;
  triggerRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    const frame = requestAnimationFrame(() => {
      (content?.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? content)?.focus();
    });
    const trigger = triggerRef?.current ?? (document.activeElement as HTMLElement | null);
    return () => {
      cancelAnimationFrame(frame);
      if (document.activeElement === document.body || content?.contains(document.activeElement)) {
        trigger?.focus({ preventScroll: true });
      }
    };
  }, [triggerRef]);

  return (
    <div
      ref={contentRef}
      role="menu"
      tabIndex={-1}
      aria-label={label}
      className="px-1"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "Escape") event.stopPropagation();
        if (event.key === "Tab") {
          onClose();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        );
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      {children}
    </div>
  );
}

export function ActionMenu({
  open,
  onClose,
  triggerRef,
  label,
  children,
  className,
  align,
  position,
}: ActionMenuProps) {
  const { isMobile } = useBreakpoint();
  if (!open) return null;

  const content = (
    <ActionMenuContent label={label} triggerRef={triggerRef} onClose={onClose}>
      {children}
    </ActionMenuContent>
  );

  if (isMobile) {
    return (
      <Modal onClose={onClose} maxWidth="max-w-sm">
        <ModalHeader title={label} onClose={onClose} />
        <ModalBody className="!px-0 !py-1">{content}</ModalBody>
      </Modal>
    );
  }

  return (
    <PortalMenu
      open
      onClose={onClose}
      {...(position ? { position, triggerRef } : { triggerRef: triggerRef! })}
      align={align}
      className={className}
    >
      {content}
    </PortalMenu>
  );
}

export function ActionMenuItem({
  className,
  destructive = false,
  ...props
}: ComponentProps<"button"> & { destructive?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "focus-ring flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors lg:min-h-9 lg:py-1.5",
        "disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:shrink-0",
        destructive
          ? "text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10"
          : "text-foreground hover:bg-muted focus-visible:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export function ActionMenuSeparator() {
  return <div role="separator" className="mx-2 my-1 border-t border-border/60" />;
}
