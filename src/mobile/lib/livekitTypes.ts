import type { ViewStyle } from "react-native";
import type { Participant, Track, TrackPublication } from "livekit-client";

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
