// `src` starting with `uploading:` renders the in-progress placeholder; `/api/media/` URLs serve ranged bytes for seeking.

import { useEffect, useRef } from "react";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import "video.js/dist/video-js.css";
import "@/features/files/styles/videojs-uniffy.css";
import { usePlaybackSource } from "@/features/files/hooks/usePlaybackSource";
import { PREPARING_VIDEO, UNSUPPORTED_VIDEO } from "@/features/files/utils/playbackSource";
import { VideoCamera } from "@phosphor-icons/react";

interface VideoBlockProps {
  src: string;
  title?: string;
  mimeType?: string;
  selected?: boolean;
}

export function VideoBlock(props: VideoBlockProps) {
  return <VideoContent key={props.src} {...props} />;
}

function VideoContent({ src, title, selected, mimeType }: VideoBlockProps) {
  const playback = usePlaybackSource(src, mimeType);
  const { src: playbackSrc, type, kind, onError } = playback;
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);

  const isUploading = src.startsWith("uploading:");

  useEffect(() => {
    if (
      isUploading ||
      !playbackSrc ||
      !containerRef.current ||
      (kind !== "original" && kind !== "fallback")
    )
      return;

    const videoElement = document.createElement("video-js");
    videoElement.classList.add("vjs-big-play-centered", "vjs-fluid");
    containerRef.current.appendChild(videoElement);

    const player = videojs(videoElement, {
      controls: true,
      autoplay: false,
      preload: "metadata",
      fluid: true,
      sources: [{ src: playbackSrc, type }],
    });

    player.on("error", () => {
      void onError(player.error()?.code);
    });
    player.on("loadedmetadata", () => {
      // Browsers can accept the audio track while ignoring an unsupported video codec.
      if (!player.videoWidth() || !player.videoHeight()) void onError(4);
    });
    playerRef.current = player;

    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [playbackSrc, type, kind, onError, isUploading]);

  if (isUploading) {
    return (
      <div
        className={`video-block-container video-block-uploading${selected ? " video-block-selected" : ""}`}
      >
        <div className="video-block-uploading-content">
          <svg
            className="video-block-spinner"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="3"
            />
            <path
              d="M12 2a10 10 0 0 1 10 10"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
          <span>Uploading video...</span>
        </div>
      </div>
    );
  }

  if (!src) {
    return <div className="video-block-empty">No video source</div>;
  }

  return (
    <div className={`video-block-container${selected ? " video-block-selected" : ""}`}>
      {title && (
        <div className="video-block-header">
          <VideoCamera size={14} weight="bold" />
          <span className="video-block-header-title">{title}</span>
        </div>
      )}
      {kind === "preparing" ? (
        <p className="p-4 text-sm">{PREPARING_VIDEO}</p>
      ) : kind === "unsupported" || kind === "unavailable" ? (
        <div className="p-4 text-sm">
          <p>
            {kind === "unsupported"
              ? UNSUPPORTED_VIDEO
              : "Unable to load video. Check your connection and access."}
          </p>
          {kind === "unsupported" && (
            <a className="text-primary underline" href={playback.downloadUrl} download={title}>
              Download video
            </a>
          )}
        </div>
      ) : (
        <div
          ref={containerRef}
          className="video-block-player-wrapper"
          data-vjs-player
          data-managed-playback
        />
      )}
    </div>
  );
}
