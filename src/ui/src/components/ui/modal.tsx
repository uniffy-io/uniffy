import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { dialogShellClass } from "@/components/ui/popover";
import { ButtonSizeContext } from "@/components/ui/buttonSize";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";

const ANIMATION_MS = 150;

const ModalLabelContext = createContext<string | undefined>(undefined);

interface ModalProps {
  children: React.ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  maxWidth?: string;
  className?: string;
  /** Accessible name for a dialog that renders no ModalHeader. */
  ariaLabel?: string;
}

/**
 * Dialog shell: backdrop, portal, escape handling, and the surface tone. Compose the
 * chrome from ModalHeader / ModalBody / ModalFooter so every dialog reads the same.
 */
export function Modal({
  children,
  onClose,
  closeDisabled = false,
  maxWidth = "max-w-lg",
  className,
  ariaLabel,
}: ModalProps) {
  const [phase, setPhase] = useState<"entering" | "open" | "exiting">("entering");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const titleId = useId();

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setPhase("open");
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const requestClose = useCallback(() => {
    if (closeDisabled || phase === "exiting") return;
    setPhase("exiting");
    timerRef.current = setTimeout(onClose, ANIMATION_MS);
  }, [closeDisabled, phase, onClose]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useOverlayEscape(requestClose);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  const isVisible = phase === "open";

  // Rendered through a portal: an ancestor's transform (e.g. another
  // Modal's scale transition) would otherwise become the containing
  // block for `fixed` and clip nested dialogs.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div
        className={cn(
          "absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-150",
          isVisible ? "opacity-100" : "opacity-0",
        )}
        onClick={requestClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : titleId}
        className={cn(
          dialogShellClass,
          "relative w-[calc(100vw-2rem)] rounded-t-xl sm:rounded-xl overflow-hidden",
          "transition-all duration-150 ease-out",
          isVisible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-2",
          maxWidth,
          className,
        )}
      >
        <ModalLabelContext.Provider value={titleId}>{children}</ModalLabelContext.Provider>
      </div>
    </div>,
    document.body,
  );
}

interface ModalHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Renders a close control. Only for dialogs whose footer carries no Cancel or Close action. */
  onClose?: () => void;
  closeDisabled?: boolean;
  closeTestId?: string;
  /** Controls placed right of the title, before the close control. */
  actions?: React.ReactNode;
  className?: string;
}

export function ModalHeader({
  title,
  description,
  onClose,
  closeDisabled = false,
  closeTestId,
  actions,
  className,
}: ModalHeaderProps) {
  const titleId = useContext(ModalLabelContext);
  return (
    <div className={cn("flex items-start gap-3 px-6 py-4 border-b border-border", className)}>
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="text-xl font-semibold text-foreground break-words">
          {title}
        </h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label="Close"
          data-testid={closeTestId}
          className="shrink-0 -mr-1.5 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <X size={16} weight="bold" />
        </button>
      ) : null}
    </div>
  );
}

interface ModalBodyProps {
  children: React.ReactNode;
  className?: string;
  /** Off when the dialog owns its own scroll region (flex column layouts). */
  scrollable?: boolean;
}

export function ModalBody({ children, className, scrollable = true }: ModalBodyProps) {
  return (
    <div
      className={cn(
        "px-6 py-5 space-y-5",
        scrollable && "max-h-[65dvh] overflow-y-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function ModalFooter({ children, className }: ModalFooterProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 px-6 py-4 border-t border-border",
        className,
      )}
    >
      <ButtonSizeContext.Provider value="md">{children}</ButtonSizeContext.Provider>
    </div>
  );
}
