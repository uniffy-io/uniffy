import { ScreenSharePresets, VideoPreset } from "livekit-client";
import type { VideoEncoding, VideoResolution } from "livekit-client";
import { ScreenShareQuality } from "@uniffy/proto/calls/v1/calls_pb";

export interface ScreenShareConfig {
  /** getDisplayMedia capture ceiling; native (0x0) for MAX. */
  captureResolution: VideoResolution;
  /** Top simulcast layer the publisher sends. */
  encoding: VideoEncoding;
  /** Lower rungs added beneath the top layer; weak viewers fall back through these. */
  simulcastLayers: VideoPreset[];
}

const FHD: VideoResolution = { width: 1920, height: 1080, frameRate: 30 };

// Lower simulcast rungs. The SDK scales these relative to the real capture size,
// so a 4K source still gets proportional fallbacks.
const HALF = new VideoPreset(960, 540, 1_500_000, 30);
const QUARTER = new VideoPreset(480, 270, 600_000, 15);

const BALANCED: ScreenShareConfig = {
  captureResolution: FHD,
  encoding: { maxBitrate: 6_000_000, maxFramerate: 30 },
  simulcastLayers: [HALF],
};

const HIGH: ScreenShareConfig = {
  captureResolution: FHD,
  encoding: { maxBitrate: 10_000_000, maxFramerate: 30 },
  simulcastLayers: [QUARTER, HALF],
};

const MAX: ScreenShareConfig = {
  captureResolution: ScreenSharePresets.original.resolution,
  encoding: { maxBitrate: 16_000_000, maxFramerate: 30 },
  simulcastLayers: [QUARTER, HALF],
};

const CONFIG_BY_TIER: Record<ScreenShareQuality, ScreenShareConfig> = {
  [ScreenShareQuality.UNSPECIFIED]: BALANCED,
  [ScreenShareQuality.BALANCED]: BALANCED,
  [ScreenShareQuality.HIGH]: HIGH,
  [ScreenShareQuality.MAX]: MAX,
};

export function screenShareConfig(tier: ScreenShareQuality): ScreenShareConfig {
  return CONFIG_BY_TIER[tier] ?? BALANCED;
}

/** User preference clamped to the org-resolved ceiling; an unset pref follows the cap. */
export function clampQuality(
  pref: ScreenShareQuality,
  cap: ScreenShareQuality,
): ScreenShareQuality {
  if (pref === ScreenShareQuality.UNSPECIFIED) return cap;
  return Math.min(pref, cap) as ScreenShareQuality;
}

export const SCREEN_SHARE_QUALITY_LABEL: Record<ScreenShareQuality, string> = {
  [ScreenShareQuality.UNSPECIFIED]: "Auto",
  [ScreenShareQuality.BALANCED]: "Balanced",
  [ScreenShareQuality.HIGH]: "High",
  [ScreenShareQuality.MAX]: "Maximum",
};

/** Tiers a user may pick at or below the resolved cap, lowest-first. */
export function selectableTiers(cap: ScreenShareQuality): ScreenShareQuality[] {
  return [ScreenShareQuality.BALANCED, ScreenShareQuality.HIGH, ScreenShareQuality.MAX].filter(
    (tier) => tier <= cap,
  );
}
