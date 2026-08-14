import { useEffect, useRef, useState, useCallback } from "react";
import { Stop, X, Microphone } from "@phosphor-icons/react";

interface AudioRecordingBarProps {
  onComplete: (blob: Blob) => void;
  onCancel: () => void;
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Pick the best supported MIME type for audio recording.
 * Prefers webm (opus) for broad browser support, falls back to mp4/mpeg.
 */
function getRecordingMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}

const NUM_BARS = 5;

export function AudioRecordingBar({ onComplete, onCancel }: AudioRecordingBarProps) {
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef<string>("");
  const mountedRef = useRef(true);

  // Cleanup helper to stop all tracks and timers
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  // Start recording on mount
  useEffect(() => {
    mountedRef.current = true;

    const startRecording = async () => {
      const mimeType = getRecordingMimeType();
      if (!mimeType) {
        setError("Audio recording not supported in this browser");
        return;
      }
      mimeTypeRef.current = mimeType;

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        if (!mountedRef.current) return;
        setError("Microphone access denied");
        return;
      }

      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        if (!mountedRef.current) return;
        const blob = new Blob(chunksRef.current, { type: mimeType });
        cleanup();
        onComplete(blob);
      };

      // No timeslice: produces a single blob with proper WebM container
      // headers on stop. Using a timeslice (e.g. 100ms) splits into
      // multiple chunks where only the first has initialization data,
      // causing the concatenated blob to only play the first few seconds.
      recorder.start();
      setIsRecording(true);

      // Elapsed timer
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        if (mountedRef.current) {
          setElapsed(Math.floor((Date.now() - startTime) / 1000));
        }
      }, 100);
    };

    startRecording();

    return () => {
      mountedRef.current = false;
      // If still recording when unmounted, stop without completing
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        // Detach onstop to prevent calling onComplete after unmount
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      }
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStop = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop(); // onstop handler will call onComplete
    }
  }, []);

  const handleCancel = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    cleanup();
    onCancel();
  }, [cleanup, onCancel]);

  // Error state: show message briefly, then auto-cancel
  useEffect(() => {
    if (!error) return;
    const timeout = setTimeout(() => {
      onCancel();
    }, 2000);
    return () => clearTimeout(timeout);
  }, [error, onCancel]);

  if (error) {
    return (
      <div className="audio-recording-bar audio-recording-error">
        <Microphone size={16} weight="bold" />
        <span className="audio-recording-error-text">{error}</span>
      </div>
    );
  }

  return (
    <div className="audio-recording-bar">
      <div className="audio-recording-indicator" />
      <span className="audio-recording-label">Recording</span>
      <span className="audio-recording-time">{formatElapsed(elapsed)}</span>

      <div className="audio-recording-bars">
        {Array.from({ length: NUM_BARS }, (_, i) => (
          <div
            key={i}
            className="audio-recording-bar-line"
            style={{ animationDelay: `${i * 0.12}s` }}
          />
        ))}
      </div>

      <button
        className="audio-recording-stop-btn"
        onClick={handleStop}
        disabled={!isRecording}
        title="Stop recording"
      >
        <Stop size={14} weight="fill" />
        <span>Stop</span>
      </button>

      <button
        className="audio-recording-cancel-btn"
        onClick={handleCancel}
        title="Cancel recording"
      >
        <X size={14} weight="bold" />
      </button>
    </div>
  );
}
