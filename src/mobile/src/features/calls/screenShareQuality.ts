import type { VideoEncoding, VideoPreset } from "livekit-client";
import { ScreenShareQuality } from "@uniffy/proto/calls/v1/calls_pb";
import { loadLivekitClient } from "@features/calls/livekit";

export interface ScreenShareConfig {
  /** Top simulcast layer the publisher sends. */
  encoding: VideoEncoding;
  /** Lower rungs beneath the top layer; weak viewers fall back through these. */
  simulcastLayers: VideoPreset[];
}

/** width, height, maxBitrate, maxFramerate - materialized into a VideoPreset lazily. */
type LayerSpec = [number, number, number, number];

interface TierSpec {
  encoding: VideoEncoding;
  layers: LayerSpec[];
}

const QUARTER: LayerSpec = [480, 270, 400_000, 15];
const HALF: LayerSpec = [960, 540, 1_000_000, 15];

// Well under the web tiers (6/10/16 Mbps): a phone uplink does not sustain those,
// and legibility on a shared screen is a resolution-and-bitrate question rather
// than a framerate one, so the lower tiers trade frames away first.
const BALANCED: TierSpec = {
  encoding: { maxBitrate: 2_500_000, maxFramerate: 15 },
  layers: [HALF],
};

const HIGH: TierSpec = {
  encoding: { maxBitrate: 4_000_000, maxFramerate: 15 },
  layers: [QUARTER, HALF],
};

const MAX: TierSpec = {
  encoding: { maxBitrate: 6_000_000, maxFramerate: 30 },
  layers: [QUARTER, HALF],
};

const SPEC_BY_TIER: Record<ScreenShareQuality, TierSpec> = {
  [ScreenShareQuality.UNSPECIFIED]: BALANCED,
  [ScreenShareQuality.BALANCED]: BALANCED,
  [ScreenShareQuality.HIGH]: HIGH,
  [ScreenShareQuality.MAX]: MAX,
};

/**
 * Capture resolution is deliberately absent: React Native's getDisplayMedia takes
 * no arguments, so the capture ceiling web passes is dropped on the floor here.
 * Only the publish side - encoding and simulcast layers - carries the org limit.
 */
export function screenShareConfig(tier: ScreenShareQuality): ScreenShareConfig {
  const spec = SPEC_BY_TIER[tier] ?? BALANCED;
  const livekit = loadLivekitClient();
  return {
    encoding: spec.encoding,
    simulcastLayers: livekit
      ? spec.layers.map(([width, height, bitrate, fps]) => {
          return new livekit.VideoPreset(width, height, bitrate, fps);
        })
      : [],
  };
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

/** Tiers a user may pick at or below the resolved cap, lowest first. */
export function selectableTiers(cap: ScreenShareQuality): ScreenShareQuality[] {
  return [ScreenShareQuality.BALANCED, ScreenShareQuality.HIGH, ScreenShareQuality.MAX].filter(
    (tier) => tier <= cap,
  );
}
