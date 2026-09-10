/** Plays through the `/api/media` Range route; a file still being transcoded shows a processing state instead of a player. */

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@phosphor-icons/react";
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
import { fetchFile } from "@/features/files/store/filesThunks";
import { useMedia } from "@/features/files/components/viewer/hooks/useMedia";
import { isTranscodePending } from "@/features/files/utils/transcodeGate";
import type { SerializedFile } from "@/features/files/store/filesThunks";

// Formats that browsers typically don't support
// Note: video/quicktime (.mov) removed - many .mov files use H.264/AAC which browsers support
// The player will show an error if the specific codec isn't supported
const UNSUPPORTED_FORMATS = ["video/x-msvideo", "video/x-ms-wmv"];

// FILE_UPDATED only reaches the owner's stream; polling covers shared viewers
// and dropped connections.
const TRANSCODE_POLL_MS = 5000;

const UNSUPPORTED_MESSAGE =
  "This video format is not supported by your browser. Try downloading the file instead.";

interface VideoViewerProps {
  file: SerializedFile;
}

export function VideoViewer({ file }: VideoViewerProps) {
  const dispatch = useAppDispatch();
  const transcoding = isTranscodePending(file.transcodeStatus);

  useEffect(() => {
    if (!transcoding) return;
    const timer = window.setInterval(() => {
      void dispatch(fetchFile(file.id));
    }, TRANSCODE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [transcoding, file.id, dispatch]);

  if (transcoding) {
    return (
      <div className="viewer-loading flex-col gap-4 p-8 text-center">
        <Spinner size={48} className="animate-spin" />
        <p>Preparing this video for playback. It will be ready in about a minute.</p>
      </div>
    );
  }

  // Keyed per file so paging in the playlist never carries a previous file's error state.
  return <VideoPlayer key={file.id} file={file} />;
}

function VideoPlayer({ file }: VideoViewerProps) {
  const dispatch = useAppDispatch();
  // Per-field subscriptions -- subscribing to the whole slice re-rendered
  // the player on every timeupdate (currentTime changes every ~250ms),
  // which thrashed videojs and caused intermittent stream errors.
  const isPlaying = useAppSelector((state) => state.fileViewer.isPlaying);
  const volume = useAppSelector((state) => state.fileViewer.volume);
  const isMuted = useAppSelector((state) => state.fileViewer.isMuted);
  const { url: streamUrl, error: mediaError } = useMedia(file.id);
  const [error, setError] = useState<string | null>(null);

  const videoContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);

  const isUnsupportedFormat = UNSUPPORTED_FORMATS.includes(file.mimeType);

  useEffect(() => {
    if (!videoContainerRef.current || !streamUrl) {
      return;
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
      console.error("[VideoViewer] Playback error:", {
        code: err?.code,
        message: err?.message,
        mimeType: file.mimeType,
      });
      if (err?.code !== 4) {
        setError("Failed to play video");
        return;
      }
      // A file whose transcode started after this row was loaded answers 425 and
      // surfaces here as an unsupported source. Refresh the row first: a pending
      // status hands over to the processing state instead of an error.
      void dispatch(fetchFile(file.id))
        .unwrap()
        .then((fresh) => {
          if (!isTranscodePending(fresh.transcodeStatus)) setError(UNSUPPORTED_MESSAGE);
        })
        .catch(() => setError(UNSUPPORTED_MESSAGE));
    });

    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [streamUrl, file.id, file.mimeType, dispatch]);

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

  if (mediaError || !streamUrl) {
    return (
      <div className="viewer-error">
        <p>{mediaError ?? "Unable to load video"}</p>
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
