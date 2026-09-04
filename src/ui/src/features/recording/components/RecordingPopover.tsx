import { useEffect, useRef } from "react";
import { VideoCamera } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { popoverShellClass } from "@/components/ui/popover";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { cn } from "@/shared/utils/cn";
import { RecordingSourcePicker } from "@/features/recording/components/RecordingSourcePicker";
import { RecordingMicPicker } from "@/features/recording/components/RecordingMicPicker";
import { RecordingTabAudioToggle } from "@/features/recording/components/RecordingTabAudioToggle";
import { RecordingQuotaBanner } from "@/features/recording/components/RecordingQuotaBanner";
import { startRecording } from "@/features/recording/store/recordingThunks";
import { checkQuotaBeforeRecord } from "@/features/recording/utils/checkQuotaBeforeRecord";

interface RecordingPopoverProps {
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

export function RecordingPopover({ onClose, anchorRef }: RecordingPopoverProps) {
  const dispatch = useAppDispatch();
  const panelRef = useRef<HTMLDivElement>(null);
  const recordingState = useAppSelector((state) => state.recording.state);
  const source = useAppSelector((state) => state.recording.source);
  const usedBytes = useAppSelector((state) => state.files.myStorageUsage.usedBytes);
  const quotaBytes = useAppSelector((state) => state.files.myStorageUsage.quotaBytes);

  const quotaWarning = checkQuotaBeforeRecord({
    quotaBytes,
    usedBytes,
  });

  const canRecord =
    recordingState === "idle" || recordingState === "done" || recordingState === "error";

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      // Sub-popovers (mic Select) portal to document.body; skip those so picking an option doesn't close the parent.
      if (target instanceof Element && target.closest("[data-select-portal]")) {
        return;
      }
      onClose();
    }
    const timeoutId = window.setTimeout(() => {
      document.addEventListener("mousedown", handlePointerDown, true);
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handlePointerDown, true);
    };
  }, [onClose, anchorRef]);

  useOverlayEscape(onClose);

  const handleRecord = () => {
    void dispatch(startRecording());
    onClose();
  };

  // `getDisplayMedia` always shows the OS picker; `displaySurface` is only a hint.
  const SHARE_HINT_BY_SOURCE: Record<typeof source, string> = {
    screen: "Your browser will ask which screen to share.",
    window: "Your browser will ask which window to share.",
    tab: "Your browser will ask which tab to share.",
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Start screen recording"
      className={cn(
        popoverShellClass,
        "absolute right-0 z-[100] mt-1.5 w-[min(320px,calc(100vw-2rem))] origin-top-right rounded-xl",
        "animate-in fade-in slide-in-from-top-2 duration-150",
        "flex flex-col overflow-hidden",
      )}
    >
      <div className="px-3.5 py-3 border-b border-border/60">
        <h2 className="text-sm font-semibold">Record screen</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Choose what to capture and which mic to use.
        </p>
      </div>

      <div className="flex flex-col gap-3 px-3.5 py-3">
        {quotaWarning && <RecordingQuotaBanner warning={quotaWarning} />}

        <RecordingSourcePicker />

        <RecordingMicPicker enabled />

        {source === "tab" && <RecordingTabAudioToggle />}
      </div>

      <div className="px-3.5 py-3 border-t border-border/60 flex items-center justify-between gap-3">
        <p className="text-[11px] leading-snug text-muted-foreground/70">
          {SHARE_HINT_BY_SOURCE[source]}
        </p>
        <button
          type="button"
          onClick={handleRecord}
          disabled={!canRecord}
          className={cn(
            "shrink-0 inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium",
            "bg-red-500 text-white shadow-sm",
            "hover:bg-red-600 transition-colors",
            "focus-ring",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <VideoCamera size={16} weight="fill" />
          Record
        </button>
      </div>
    </div>
  );
}
