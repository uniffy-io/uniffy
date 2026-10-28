import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import type { Participant } from "livekit-client";
import { useAuth } from "@core/providers/AuthContext";
import { useCall } from "@features/calls/CallContext";
import { callsApi } from "@features/calls/callsApi";
import { callErrorMessage } from "@features/calls/callErrors";
import { participantLabel } from "@features/calls/components/ParticipantTile";

export function useParticipantActions(canModerate: boolean) {
  const { organizationId } = useAuth();
  const { session, showFeedback } = useCall();
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);
  const prompt = useCallback(
    (participant: Participant) => {
      if (!canModerate || participant.isLocal || !organizationId || !session.callId || busy.current)
        return;
      const callId = session.callId;
      const run = async (remove: boolean) => {
        if (busy.current) return;
        busy.current = true;
        setPending(participant.identity);
        try {
          await (remove ? callsApi.kickParticipant : callsApi.muteParticipant)({
            organizationId,
            callId,
            identity: participant.identity,
          });
        } catch (error) {
          showFeedback(callErrorMessage(error));
        } finally {
          busy.current = false;
          setPending(null);
        }
      };
      Alert.alert(participantLabel(participant), "Host controls", [
        ...(participant.isMicrophoneEnabled
          ? [
              {
                text: "Mute microphone",
                onPress: () => {
                  void run(false);
                },
              },
            ]
          : []),
        {
          text: "Remove from call",
          style: "destructive",
          onPress: () =>
            Alert.alert(
              "Remove participant?",
              `${participantLabel(participant)} will leave this call.`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Remove",
                  style: "destructive",
                  onPress: () => {
                    void run(true);
                  },
                },
              ],
            ),
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [canModerate, organizationId, session.callId, showFeedback],
  );
  return { prompt, pending };
}
