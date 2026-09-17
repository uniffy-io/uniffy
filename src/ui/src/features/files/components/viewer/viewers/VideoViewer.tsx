/** Original playback falls back to a completed compatibility copy. */

import { useEffect, useRef } from "react";
import { Spinner } from "@phosphor-icons/react";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import "video.js/dist/video-js.css";
import "@/features/files/styles/videojs-uniffy.css";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  setPlaying,
  setCurrentTime,
  setDuration,
  setViewerLoading,
} from "@/features/files/store/viewerSlice";
import { useMedia } from "@/features/files/components/viewer/hooks/useMedia";
import { usePlaybackSource } from "@/features/files/hooks/usePlaybackSource";
import { PREPARING_VIDEO, UNSUPPORTED_VIDEO } from "@/features/files/utils/playbackSource";
import type { SerializedFile } from "@/features/files/store/filesThunks";

interface VideoViewerProps {
  file: SerializedFile;
}

export function VideoViewer({ file }: VideoViewerProps) {
  const { url, error } = useMedia(file.id);
  if (!url) return <div className="viewer-error"><p>{error ?? "Unable to load video"}</p></div>;
  return <VideoPlayer key={`${file.id}:${file.version}:${url}`} file={file} streamUrl={url} />;
}

function VideoPlayer({ file, streamUrl }: VideoViewerProps & { streamUrl: string }) {
  const dispatch = useAppDispatch();
  // Playback time updates must not recreate the player.
  const isPlaying = useAppSelector((state) => state.fileViewer.isPlaying);
  const volume = useAppSelector((state) => state.fileViewer.volume);
  const isMuted = useAppSelector((state) => state.fileViewer.isMuted);
  const playback = usePlaybackSource(streamUrl, file.mimeType, file.version);
  const { src, type, kind, onError } = playback;

  const videoContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);

  useEffect(() => {
    if (!videoContainerRef.current || !src || (kind !== "original" && kind !== "fallback")) {
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
          src,
          type,
        },
      ],
    });

    playerRef.current = player;

    player.on("loadedmetadata", () => {
      if (!player.videoWidth() || !player.videoHeight()) {
        void onError(4);
        return;
      }
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
      void onError(player.error()?.code);
    });

    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [src, type, kind, onError, dispatch]);

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
    if (!player) return;

    try {
      player.volume(volume);
      player.muted(isMuted);
    } catch {
      // Ignore errors if player is in error state
    }
  }, [volume, isMuted]);

  if (kind === "preparing") {
    return (
      <div className="viewer-loading flex-col gap-4 p-8 text-center">
        <Spinner size={48} className="animate-spin" />
        <p>{PREPARING_VIDEO}</p>
      </div>
    );
  }
  if (kind === "unsupported" || kind === "unavailable") {
    return (
      <div className="viewer-error">
        <p>
          {kind === "unsupported"
            ? UNSUPPORTED_VIDEO
            : "Unable to load video. Check your connection and access."}
        </p>
        {kind === "unsupported" && (
          <a
            className="text-primary underline"
            href={playback.downloadUrl}
            download={file.filename}
          >
            Download video
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-background">
      <div
        ref={videoContainerRef}
        className="w-full max-w-6xl max-h-full"
        data-vjs-player
        data-managed-playback
      />
    </div>
  );
}
