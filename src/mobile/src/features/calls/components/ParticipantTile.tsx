import React from "react";
import { View, Text, StyleSheet, type ViewStyle } from "react-native";
import { MicrophoneSlash, CellSignalLow } from "phosphor-react-native";
import type { Participant, Track } from "livekit-client";
import { Avatar } from "@shared/components/Avatar";
import { loadLivekitClient, VideoTrackView } from "@features/calls/livekit";
import { useCall } from "@features/calls/CallContext";
import { identityUserId } from "@features/calls/callsSerializer";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";

const livekit = loadLivekitClient();

export function participantLabel(participant: Participant): string {
  return participant.name || identityUserId(participant.identity);
}

export function ParticipantTile({
  participant,
  T,
  source,
  style,
  compact = false,
}: {
  participant: Participant;
  T: ThemeColors;
  source?: Track.Source;
  style?: ViewStyle;
  compact?: boolean;
}) {
  // Reads mutable livekit state (publications, mute flags, speaking) during
  // render; opt out of React Compiler memoization or the tile never updates.
  "use no memo";
  const { session } = useCall();
  // Participants only exist on clients where livekit loads.
  if (!livekit) return null;
  const trackSource = source ?? livekit.Track.Source.Camera;
  const publication = participant.getTrackPublication(trackSource);
  const hasVideo =
    !!publication?.track &&
    !publication.isMuted &&
    (participant.isLocal || publication.isSubscribed);
  const isScreen = trackSource === livekit.Track.Source.ScreenShare;
  const speaking = participant.isSpeaking && !isScreen;
  const micMuted = !isScreen && participant.isMicrophoneEnabled === false;
  const poorConnection = participant.connectionQuality === livekit.ConnectionQuality.Poor;
  const name = participantLabel(participant);

  return (
    <View
      style={[
        styles.tile,
        { backgroundColor: T.surface, borderColor: speaking ? T.green : T.border },
        speaking && styles.speakingBorder,
        style,
      ]}
    >
      {hasVideo && publication ? (
        <VideoTrackView
          // Flipping the local camera restarts the track but does not repaint the
          // native view; re-key on the facing direction so it remounts onto the
          // fresh track instead of freezing on the last front-camera frame.
          key={participant.isLocal && !isScreen ? session.cameraFacing : undefined}
          trackRef={{ participant, publication, source: trackSource }}
          style={styles.video}
          // Camera fills its tile; only a shared screen is letterboxed so no
          // content is cropped away.
          objectFit={isScreen ? "contain" : "cover"}
          // Only the front (selfie) camera is mirrored; the back camera shows the
          // world the right way round.
          mirror={participant.isLocal && !isScreen && session.cameraFacing === "user"}
        />
      ) : (
        <View style={styles.avatarWrap}>
          <Avatar name={name} size={compact ? 36 : 56} />
        </View>
      )}
      <View style={styles.badgeRow} pointerEvents="none">
        <Text
          style={[styles.name, { color: "#ffffff" }, compact && styles.nameCompact]}
          numberOfLines={1}
        >
          {participant.isLocal ? "You" : name}
        </Text>
        {micMuted ? (
          <MicrophoneSlash size={compact ? 11 : 13} color="#ffffff" weight="fill" />
        ) : null}
        {poorConnection ? (
          <CellSignalLow size={compact ? 11 : 13} color={T.red} weight="fill" />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    justifyContent: "center",
  },
  speakingBorder: { borderWidth: 2 },
  video: { ...StyleSheet.absoluteFill },
  avatarWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  badgeRow: {
    position: "absolute",
    left: 8,
    bottom: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    maxWidth: "85%",
  },
  name: { fontSize: 12, fontFamily: FONT.medium, flexShrink: 1 },
  nameCompact: { fontSize: 10 },
});
