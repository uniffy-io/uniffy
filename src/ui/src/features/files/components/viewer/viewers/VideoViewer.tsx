/** Seeking flows through the media service worker's Range handler. */

import { useEffect, useRef, useState } from "react";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import "video.js/dist/video-js.css";
import "../../../styles/videojs-uniffy.css";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  setPlaying,
  setCurrentTime,
  setDuration,
  setViewerLoading,
} from "@/features/files/store/viewerSlice";
import { useMedia } from "@/features/files/components/viewer/hooks/useMedia";
import type { SerializedFile } from "@/features/files/store/filesThunks";

// Formats that browsers typically don't support
// Note: video/quicktime (.mov) removed - many .mov files use H.264/AAC which browsers support
// The player will show an error if the specific codec isn't supported
const UNSUPPORTED_FORMATS = ["video/x-msvideo", "video/x-ms-wmv"];

interface VideoViewerProps {
  file: SerializedFile;
}

export function VideoViewer({ file }: VideoViewerProps) {
  const dispatch = useAppDispatch();
  // Per-field subscriptions -- subscribing to the whole slice re-rendered
  // the player on every timeupdate (currentTime changes every ~250ms),
  // which thrashed videojs and caused intermittent stream errors.
  const isPlaying = useAppSelector((state) => state.fileViewer.isPlaying);
  const volume = useAppSelector((state) => state.fileViewer.volume);
  const isMuted = useAppSelector((state) => state.fileViewer.isMuted);
  const { url: streamUrl, loading: swLoading, error: swError } = useMedia(file.id);
  const [error, setError] = useState<string | null>(null);

  const videoContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);

  // Check for unsupported formats
  const isUnsupportedFormat = UNSUPPORTED_FORMATS.includes(file.mimeType);

  useEffect(() => {
    if (!videoContainerRef.current || !streamUrl) {
      return;
    }

    // Check if SW is controlling before loading
    const swController = navigator.serviceWorker?.controller;
    if (!swController) {
      console.warn(
        "[VideoViewer] No Service Worker controller - requests will NOT be intercepted!",
      );
    }

    dispatch(setViewerLoading(true));

    const videoElement = document.createElement("video-js");
    videoElement.classList.add("vjs-big-play-centered", "vjs-fluid");
    videoContainerRef.current.appendChild(videoElement);

    const player = videojs(videoElement, {
      controls: true,
      autoplay: false,
      preload: "auto",
      fluid: true,
      playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
      sources: [
        {
          src: streamUrl,
          type: file.mimeType,
        },
      ],
    });

    playerRef.current = player;

    // Event handlers
    player.on("loadedmetadata", () => {
      dispatch(setDuration(player.duration() || 0));
      dispatch(setViewerLoading(false));
    });

    player.on("play", () => {
      dispatch(setPlaying(true));
    });

    player.on("pause", () => {
      dispatch(setPlaying(false));
    });

    player.on("timeupdate", () => {
      dispatch(setCurrentTime(player.currentTime() || 0));
    });

    player.on("ended", () => {
      dispatch(setPlaying(false));
    });

    player.on("error", () => {
      dispatch(setViewerLoading(false));
      const err = player.error();
      const swController = navigator.serviceWorker?.controller;
      console.error("[VideoViewer] Playback error:", {
        code: err?.code,
        message: err?.message,
        streamUrl,
        mimeType: file.mimeType,
        swControlling: !!swController,
      });
      if (err?.code === 4) {
        // Check if this might be a SW issue
        if (!swController) {
          setError("Media streaming unavailable. Please refresh the page.");
        } else {
          setError(
            "This video format is not supported by your browser. Try downloading the file instead.",
          );
        }
      } else {
        setError("Failed to play video");
      }
    });

    // Cleanup
    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [streamUrl, file.mimeType, dispatch]);

  // Sync play state
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    try {
      if (isPlaying && player.paused()) {
        player.play();
      } else if (!isPlaying && !player.paused()) {
        player.pause();
      }
    } catch {
      // Ignore play/pause errors (e.g., user hasn't interacted yet)
    }
  }, [isPlaying]);

  // Sync volume
  useEffect(() => {
    const player = playerRef.current;
    if (!player || error) return;

    try {
      player.volume(volume);
      player.muted(isMuted);
    } catch {
      // Ignore errors if player is in error state
    }
  }, [volume, isMuted, error]);

  if (swLoading) {
    return (
      <div className="viewer-loading">
        <span>Initializing media player...</span>
      </div>
    );
  }

  if (swError) {
    return (
      <div className="viewer-error">
        <p>{swError}</p>
        <button onClick={() => window.location.reload()} className="viewer-btn px-4 py-2">
          Refresh Page
        </button>
      </div>
    );
  }

  if (!streamUrl) {
    return (
      <div className="viewer-error">
        <p>Unable to load video</p>
      </div>
    );
  }

  if (error || isUnsupportedFormat) {
    return (
      <div className="viewer-error">
        <p>{error || "This video format is not supported by your browser."}</p>
        <p className="text-sm mt-2 text-slate-500">Format: {file.mimeType}</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-[#0a0a0f]">
      <div ref={videoContainerRef} className="w-full max-w-6xl max-h-full" data-vjs-player />
    </div>
  );
}
