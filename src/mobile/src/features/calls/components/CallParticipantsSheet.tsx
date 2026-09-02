import React from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import { MicrophoneSlash, VideoCamera, MonitorArrowUp } from "phosphor-react-native";
import type { Participant } from "livekit-client";
import { useCall } from "@features/calls/CallContext";
import { useAuth } from "@core/providers/AuthContext";
import { callsApi } from "@features/calls/callsApi";
import { participantLabel } from "@features/calls/components/ParticipantTile";
import { loadLivekitClient } from "@features/calls/livekit";
import { Avatar } from "@shared/components/Avatar";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetRow } from "@shared/components/SheetRow";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

const livekit = loadLivekitClient();

/**
 * The discoverable route to the host actions. Long-pressing a tile does the same
 * thing, but a long press on a video tile is not something a screen reader, or a
 * first-time user, will ever find.
 */
export function CallParticipantsSheet({
  visible,
  onClose,
  participants,
  isHost,
}: {
  visible: boolean;
  onClose: () => void;
  participants: Participant[];
  isHost: boolean;
}) {
  // Reads mutable livekit state (mute flags, publications) during render; opt
  // out of React Compiler memoization or a row never follows a mute or a share.
  "use no memo";
  const T = useTheme();
  const { organizationId } = useAuth();
  const { session } = useCall();

  const promptHostActions = (participant: Participant) => {
    if (!organizationId || !session.callId) return;
    const callId = session.callId;
    Alert.alert(participantLabel(participant), undefined, [
      {
        text: "Mute microphone",
        onPress: () => {
          callsApi
            .muteParticipant({ organizationId, callId, identity: participant.identity })
            .catch(() => {});
        },
      },
      {
        text: "Remove from call",
        style: "destructive",
        onPress: () => {
          callsApi
            .kickParticipant({ organizationId, callId, identity: participant.identity })
            .catch(() => {});
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader title={`In this call (${participants.length})`} />
      {participants.map((participant) => {
        const name = participantLabel(participant);
        const muted = participant.isMicrophoneEnabled === false;
        const sharing =
          !!livekit && !!participant.getTrackPublication(livekit.Track.Source.ScreenShare)?.track;
        const actionable = isHost && !participant.isLocal;
        const state = [muted ? "muted" : null, sharing ? "sharing screen" : null]
          .filter(Boolean)
          .join(", ");
        return (
          <SheetRow
            key={participant.identity}
            leading={<Avatar name={name} size={28} />}
            title={participant.isLocal ? `${name} (you)` : name}
            subtitle={
              actionable
                ? state
                  ? `${state} - tap for host actions`
                  : "Tap for host actions"
                : state || undefined
            }
            trailing={
              <View style={styles.badges}>
                {muted ? <MicrophoneSlash size={14} color={T.textDim} weight="fill" /> : null}
                {participant.isCameraEnabled ? (
                  <VideoCamera size={14} color={T.textDim} weight="fill" />
                ) : null}
                {sharing ? <MonitorArrowUp size={14} color={T.accent} weight="fill" /> : null}
              </View>
            }
            onPress={() => {
              if (actionable) promptHostActions(participant);
            }}
          />
        );
      })}
      {participants.length === 0 ? (
        <Text style={[styles.empty, { color: T.textDim }]}>No one here yet</Text>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: "row", alignItems: "center", gap: 6 },
  empty: { fontSize: 13, fontFamily: FONT.regular, paddingHorizontal: 16, paddingVertical: 14 },
});
