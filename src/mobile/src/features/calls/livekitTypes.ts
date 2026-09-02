import type { ViewStyle } from "react-native";
import type { LocalVideoTrack, Participant, Track, TrackPublication } from "livekit-client";

// Structurally identical to @livekit/components-react's TrackReference so the
// native VideoTrack component accepts it without the web bundle needing that
// package in its module graph.
export interface CallTrackRef {
  participant: Participant;
  publication: TrackPublication;
  source: Track.Source;
}

export interface VideoTrackViewProps {
  trackRef: CallTrackRef | undefined;
  style?: ViewStyle;
  objectFit?: "cover" | "contain";
  mirror?: boolean;
  zOrder?: number;
}

/** A track with no room behind it - the pre-join preview, before any call exists. */
export interface LocalVideoPreviewProps {
  track: LocalVideoTrack | null;
  style?: ViewStyle;
  objectFit?: "cover" | "contain";
  mirror?: boolean;
}
