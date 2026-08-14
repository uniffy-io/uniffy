import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionQuality, Track } from "livekit-client";
import type { Participant } from "livekit-client";
import {
  MicrophoneSlash,
  CellSignalLow,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
} from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { getInitials } from "@/components/subject/utils";

interface ParticipantTileProps {
  participant: Participant;
  /** Camera tile by default; pass ScreenShare for a share surface. */
  source?: Track.Source.Camera | Track.Source.ScreenShare;
  displayName?: string;
  className?: string;
  onClick?: () => void;
  /** Wheel/drag/double-click zoom into the video (screen shares only). */
  zoomable?: boolean;
}

interface ZoomState {
  scale: number;
  tx: number;
  ty: number;
}

const ZOOM_FIT: ZoomState = { scale: 1, tx: 0, ty: 0 };
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.5;
const DOUBLE_CLICK_SCALE = 2.5;

function clampPan(t: number, dim: number, scale: number): number {
  const max = (dim * (scale - 1)) / 2 + dim / 4;
  return Math.min(Math.max(t, -max), max);
}

export function ParticipantTile({
  participant,
  source = Track.Source.Camera,
  displayName,
  className,
  onClick,
  zoomable = false,
}: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    tx: number;
    ty: number;
  } | null>(null);
  const [zoom, setZoom] = useState<ZoomState>(ZOOM_FIT);
  const isScreen = source === Track.Source.ScreenShare;

  const videoPub = participant.getTrackPublication(source);
  const videoTrack = videoPub?.track;
  const hasVideo = !!videoTrack && !videoPub.isMuted;

  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  const micMuted = !micPub || micPub.isMuted;

  const name = displayName || participant.name || participant.identity;
  const speaking = participant.isSpeaking && !isScreen;
  const poorConnection = participant.connectionQuality === ConnectionQuality.Poor;

  const canZoom = zoomable && isScreen && hasVideo;
  const zoomed = zoom.scale > 1;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoTrack) return;
    videoTrack.attach(el);
    return () => {
      videoTrack.detach(el);
    };
  }, [videoTrack]);

  useEffect(() => {
    // eslint-disable-next-line react/react-compiler -- reset zoom when the track changes
    setZoom(ZOOM_FIT);
  }, [videoTrack]);

  // Native listener: React registers wheel as passive, which blocks preventDefault.
  useEffect(() => {
    const el = zoomRef.current;
    if (!el || !canZoom) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      setZoom((z) => {
        const scale = Math.min(
          Math.max(z.scale * Math.exp(-e.deltaY * 0.0015), ZOOM_MIN),
          ZOOM_MAX,
        );
        if (scale === z.scale) return z;
        if (scale <= 1) return ZOOM_FIT;
        const f = scale / z.scale;
        return {
          scale,
          tx: clampPan(px - (px - z.tx) * f, rect.width, scale),
          ty: clampPan(py - (py - z.ty) * f, rect.height, scale),
        };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [canZoom]);

  const stepZoom = useCallback((dir: 1 | -1) => {
    const rect = zoomRef.current?.getBoundingClientRect();
    setZoom((z) => {
      const scale = Math.min(
        Math.max(dir > 0 ? z.scale * ZOOM_STEP : z.scale / ZOOM_STEP, ZOOM_MIN),
        ZOOM_MAX,
      );
      if (scale <= 1) return ZOOM_FIT;
      const f = scale / z.scale;
      return {
        scale,
        tx: clampPan(z.tx * f, rect?.width ?? 0, scale),
        ty: clampPan(z.ty * f, rect?.height ?? 0, scale),
      };
    });
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!canZoom || !zoomed) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      tx: zoom.tx,
      ty: zoom.ty,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const pan = panRef.current;
    const el = zoomRef.current;
    if (!pan || pan.pointerId !== e.pointerId || !el) return;
    const rect = el.getBoundingClientRect();
    setZoom((z) => ({
      scale: z.scale,
      tx: clampPan(pan.tx + (e.clientX - pan.startX), rect.width, z.scale),
      ty: clampPan(pan.ty + (e.clientY - pan.startY), rect.height, z.scale),
    }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (panRef.current?.pointerId === e.pointerId) panRef.current = null;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!canZoom) return;
    const el = zoomRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left - rect.width / 2;
    const py = e.clientY - rect.top - rect.height / 2;
    setZoom((z) => {
      if (z.scale > 1) return ZOOM_FIT;
      return {
        scale: DOUBLE_CLICK_SCALE,
        tx: clampPan(px * (1 - DOUBLE_CLICK_SCALE), rect.width, DOUBLE_CLICK_SCALE),
        ty: clampPan(py * (1 - DOUBLE_CLICK_SCALE), rect.height, DOUBLE_CLICK_SCALE),
      };
    });
  };

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-lg bg-muted/60 border border-border/60",
        "transition-shadow duration-150",
        speaking && "ring-2 ring-emerald-400/80",
        onClick && "cursor-pointer hover:border-primary/60",
        className,
      )}
      data-testid="call-participant-tile"
      data-identity={participant.identity}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div
        ref={zoomRef}
        className={cn(
          "absolute inset-0",
          !hasVideo && "hidden",
          canZoom && (zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"),
        )}
        onPointerDown={canZoom ? onPointerDown : undefined}
        onPointerMove={canZoom ? onPointerMove : undefined}
        onPointerUp={canZoom ? onPointerUp : undefined}
        onPointerCancel={canZoom ? onPointerUp : undefined}
        onDoubleClick={canZoom ? onDoubleClick : undefined}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={cn(
            "h-full w-full",
            isScreen ? "object-contain bg-black" : "object-cover",
            !isScreen && participant.isLocal && "scale-x-[-1]",
          )}
          style={
            canZoom && zoomed
              ? {
                  transform: `translate3d(${zoom.tx}px, ${zoom.ty}px, 0) scale(${zoom.scale})`,
                }
              : undefined
          }
        />
      </div>
      {!hasVideo && (
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary text-lg font-semibold">
          {getInitials(name)}
        </div>
      )}

      <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center gap-1.5 pointer-events-none">
        <span className="max-w-full truncate rounded bg-black/50 px-1.5 py-0.5 text-[11px] font-medium text-white">
          {name}
          {participant.isLocal && !isScreen ? " (you)" : ""}
          {isScreen ? " - screen" : ""}
        </span>
        {micMuted && !isScreen && (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-black/50 text-red-400">
            <MicrophoneSlash size={12} weight="fill" />
          </span>
        )}
        {poorConnection && (
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-black/50 text-red-400"
            title="Poor connection"
          >
            <CellSignalLow size={12} weight="fill" />
          </span>
        )}
      </div>

      {canZoom && (
        <div
          className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded bg-black/50 px-1 py-0.5"
          data-testid="call-zoom-controls"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              stepZoom(-1);
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-white/80 hover:bg-white/15 disabled:opacity-40"
            disabled={!zoomed}
            aria-label="Zoom out"
          >
            <MagnifyingGlassMinus size={12} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setZoom(ZOOM_FIT);
            }}
            className={cn(
              "min-w-9 rounded px-1 text-center text-[10px] font-medium tabular-nums text-white/90",
              zoomed && "hover:bg-white/15",
            )}
            disabled={!zoomed}
            title={zoomed ? "Reset to fit" : undefined}
            aria-label="Reset zoom"
          >
            {Math.round(zoom.scale * 100)}%
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              stepZoom(1);
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-white/80 hover:bg-white/15 disabled:opacity-40"
            disabled={zoom.scale >= ZOOM_MAX}
            aria-label="Zoom in"
          >
            <MagnifyingGlassPlus size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
