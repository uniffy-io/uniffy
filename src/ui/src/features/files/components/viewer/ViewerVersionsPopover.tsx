import { useEffect, useRef, useState } from "react";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import { FileVersionsTab } from "@/features/files/components/details/FileVersionsTab";
import type { SerializedFile } from "@/features/files/store/filesThunks";

/** Manual popover instead of headlessui: the restore ConfirmDialog renders
 * inside the panel, and an unconditional outside-click close would unmount it
 * mid-confirm. Modal renders inline (no portal), so `contains()` treats the
 * dialog and its backdrop as inside. */
export function ViewerVersionsPopover({ file }: { file: SerializedFile }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && containerRef.current && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // With the confirm dialog up, Escape belongs to the dialog.
      if (containerRef.current?.querySelector('[data-testid="confirm-dialog"]')) {
        return;
      }
      event.stopPropagation();
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`viewer-btn p-2 ${open ? "bg-white/10" : ""}`}
        title="Version history"
        aria-expanded={open}
      >
        <ClockCounterClockwise size={20} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-card text-card-foreground shadow-xl p-3">
          <FileVersionsTab file={file} />
        </div>
      )}
    </div>
  );
}
