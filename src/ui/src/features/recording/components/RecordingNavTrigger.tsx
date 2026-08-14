/** Hidden on mobile (`getDisplayMedia` is unreliable there). */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  VideoCamera,
  Pause,
  Play,
  Stop,
  Microphone,
  MicrophoneSlash,
  X,
  CloudArrowUp,
  WifiSlash,
  Warning,
  ArrowClockwise,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { friendlyErrorMessage } from "@/config";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { cn } from "@/shared/utils/cn";
import { RecordingPopover } from "@/features/recording/components/RecordingPopover";
import { RecordingFirstUseModal } from "@/features/recording/components/RecordingFirstUseModal";
import { useRecordingTimer } from "@/features/recording/hooks/useRecordingTimer";
import { useBeforeUnloadGuard } from "@/features/recording/hooks/useBeforeUnloadGuard";
import { useNetworkStatus } from "@/features/recording/hooks/useNetworkStatus";
import { subscribeAvailability } from "@/features/recording/utils/crossTabRecordingLock";
import { recoverOrphanedRecordings } from "@/features/recording/utils/recoverOrphanedRecordings";
import { useScreenRecordingShortcut } from "@/features/recording/hooks/useScreenRecordingShortcut";
import { useLongRecordingNudge } from "@/features/recording/hooks/useLongRecordingNudge";
import { fetchFile } from "@/features/files/store/filesThunks";
import { openViewer } from "@/features/files/store/viewerSlice";
import { toast } from "sonner";
import {
  cancelRecording,
  pauseRecording,
  resumeRecording,
  retryUpload,
  setMicMuted,
  stopRecording,
} from "@/features/recording/store/recordingThunks";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function RecordingNavTrigger() {
  useBeforeUnloadGuard();
  useNetworkStatus();
  useScreenRecordingShortcut();
  useLongRecordingNudge();
  const dispatch = useAppDispatch();
  const { isMobile } = useBreakpoint();
  const recordingState = useAppSelector((state) => state.recording.state);
  const bytesQueued = useAppSelector((state) => state.recording.bytesQueued);
  const bytesUploaded = useAppSelector((state) => state.recording.bytesUploaded);
  const error = useAppSelector((state) => state.recording.error);
  const micDeviceId = useAppSelector((state) => state.recording.micDeviceId);
  const micMuted = useAppSelector((state) => state.recording.micMuted);
  const network = useAppSelector((state) => state.recording.network);
  const elapsed = useRecordingTimer();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [otherTabRecording, setOtherTabRecording] = useState(false);

  useEffect(() => subscribeAvailability(setOtherTabRecording), []);

  // Tab-crash recovery. Runs at most once per session via the module flag in `recoverOrphanedRecordings`.
  useEffect(() => {
    void recoverOrphanedRecordings(({ fileId, filename }) => {
      toast.success("Recovered recording from previous session", {
        description: filename,
        action: {
          label: "Open",
          onClick: () => {
            void (async () => {
              try {
                const file = await dispatch(fetchFile(fileId)).unwrap();
                dispatch(
                  openViewer({
                    fileId: file.id,
                    playlist: [file.id],
                    fileData: file,
                  }),
                );
              } catch {
                window.location.href = "/files";
              }
            })();
          },
        },
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per app session, not per render
  }, []);

  const isRecording = recordingState === "recording";
  const isPaused = recordingState === "paused";
  const isStopping =
    recordingState === "stopping" ||
    recordingState === "flushing" ||
    recordingState === "completing";
  const isStarting = recordingState === "requesting" || recordingState === "initiating-upload";
  const isError = recordingState === "error";
  const isInline = isRecording || isPaused || isStopping || isStarting || isError;
  const canMute = (isRecording || isPaused) && micDeviceId !== null;
  const uploadId = useAppSelector((state) => state.recording.uploadId);
  const canRetry = isError && uploadId !== null;

  const closePopover = useCallback(() => setPopoverOpen(false), []);

  if (isMobile) {
    return null;
  }

  if (isInline) {
    const dotClasses = cn(
      "shrink-0 w-2 h-2 rounded-full",
      isError
        ? "bg-destructive"
        : isPaused
          ? "bg-amber-400"
          : isRecording
            ? // motion-safe gates pulse; reduced-motion users see a steady stronger color.
              "bg-red-500 motion-safe:animate-pulse motion-reduce:bg-red-600"
            : "bg-amber-500",
    );

    const networkBadge =
      network === "offline"
        ? {
            Icon: WifiSlash,
            label: "Offline",
            className: "text-red-600 dark:text-red-400 bg-red-500/10",
          }
        : network === "falling-behind"
          ? {
              Icon: Warning,
              label: "Upload falling behind",
              className: "text-amber-700 dark:text-amber-300 bg-amber-500/15",
            }
          : network === "slow"
            ? {
                Icon: Warning,
                label: "Slow network",
                className: "text-yellow-700 dark:text-yellow-300 bg-yellow-500/10",
              }
            : null;

    const errorLabel = error ? (friendlyErrorMessage(error.message) ?? "Recording error") : null;

    const statusLabel = isError
      ? "Recording failed"
      : isStarting
        ? "Starting..."
        : isPaused
          ? "Paused"
          : isStopping
            ? recordingState === "flushing"
              ? "Finalizing..."
              : "Saving..."
            : null;

    return (
      <>
        <RecordingFirstUseModal />
        <div
          ref={wrapperRef}
          role="status"
          aria-live="polite"
          className="flex items-center gap-1 rounded-md border border-border bg-card pl-2 pr-1 py-0.5"
        >
          <span aria-hidden="true" className={dotClasses} />

          {statusLabel ? (
            <span className="text-xs font-medium text-foreground whitespace-nowrap">
              {statusLabel}
            </span>
          ) : (
            <span className="text-xs tabular-nums text-foreground whitespace-nowrap">
              {elapsed}
            </span>
          )}

          {(isStopping || (bytesQueued > 0 && (isRecording || isPaused))) && (
            <span
              className="ml-1 hidden lg:flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground"
              title={`${formatBytes(bytesUploaded)} uploaded of ${formatBytes(bytesQueued)} queued`}
            >
              <CloudArrowUp size={10} weight="duotone" />
              {formatBytes(bytesUploaded)}
            </span>
          )}

          {networkBadge && (
            <span
              className={cn(
                "ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
                networkBadge.className,
              )}
              title={networkBadge.label}
            >
              <networkBadge.Icon size={10} weight="fill" />
              <span className="hidden xl:inline">{networkBadge.label}</span>
            </span>
          )}

          {canMute && (
            <button
              type="button"
              onClick={() => void dispatch(setMicMuted(!micMuted))}
              title={micMuted ? "Unmute microphone" : "Mute microphone"}
              aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}
              aria-pressed={micMuted}
              className={cn(
                "inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors",
                micMuted
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {micMuted ? (
                <MicrophoneSlash size={12} weight="fill" />
              ) : (
                <Microphone size={12} weight="fill" />
              )}
            </button>
          )}

          {isRecording && (
            <button
              type="button"
              onClick={() => void dispatch(pauseRecording())}
              title="Pause recording"
              aria-label="Pause recording"
              className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Pause size={12} weight="fill" />
            </button>
          )}

          {isPaused && (
            <button
              type="button"
              onClick={() => void dispatch(resumeRecording())}
              title="Resume recording"
              aria-label="Resume recording"
              className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Play size={12} weight="fill" />
            </button>
          )}

          {(isRecording || isPaused) && (
            <button
              type="button"
              onClick={() => void dispatch(stopRecording())}
              title="Stop recording"
              aria-label="Stop recording"
              className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-red-500 hover:bg-red-600 text-white transition-colors"
            >
              <Stop size={12} weight="fill" />
            </button>
          )}

          {canRetry && (
            <button
              type="button"
              onClick={() => void dispatch(retryUpload())}
              title="Retry upload"
              aria-label="Retry upload"
              className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              <ArrowClockwise size={12} weight="bold" />
            </button>
          )}

          {(isStarting || isError) && (
            <button
              type="button"
              onClick={() => void dispatch(cancelRecording())}
              title="Cancel"
              aria-label="Cancel recording"
              className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X size={12} weight="bold" />
            </button>
          )}

          {isError && errorLabel && (
            <span
              className="hidden xl:inline ml-1 text-[10px] text-destructive truncate max-w-[120px]"
              title={errorLabel}
            >
              {errorLabel}
            </span>
          )}
        </div>
      </>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (otherTabRecording) return;
          setPopoverOpen((prev) => !prev);
        }}
        disabled={otherTabRecording}
        title={otherTabRecording ? "Recording in another tab" : "Record screen"}
        aria-label={otherTabRecording ? "Recording in another tab" : "Record screen"}
        aria-haspopup={otherTabRecording ? undefined : "dialog"}
        aria-expanded={popoverOpen}
        className={cn(
          "group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-700 ease-out overflow-hidden",
          "hover:px-2.5",
          otherTabRecording && "opacity-50 cursor-not-allowed hover:px-1.5",
        )}
      >
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />

        <span className="relative z-10 flex items-center justify-center w-7 h-7 rounded-md border border-border text-muted-foreground transition-all duration-500 ease-out group-hover:border-transparent group-hover:text-primary">
          <VideoCamera size={20} weight="duotone" />
        </span>

        <span className="relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out group-hover:ml-1.5 group-hover:max-w-24 text-muted-foreground group-hover:text-foreground">
          Record
        </span>
      </button>

      {popoverOpen && <RecordingPopover onClose={closePopover} anchorRef={wrapperRef} />}
      <RecordingFirstUseModal />
    </div>
  );
}
