import { useAuth } from "@core/providers/AuthContext";
import { useActiveCall } from "@features/calls/useCallsState";
import { canPublishInCall, AUDIENCE_MESSAGE } from "@features/calls/callPublishing";
import React, { useEffect, useState } from "react";
import { View, StyleSheet, Alert } from "react-native";
import {
  Microphone,
  MicrophoneSlash,
  VideoCamera,
  VideoCameraSlash,
  CameraRotate,
  Monitor,
  MonitorArrowUp,
  PhoneDisconnect,
} from "phosphor-react-native";
import { useCall } from "@features/calls/CallContext";
import { useAudioOutputs } from "@features/calls/useAudioOutputs";
import { isScreenSharePermitted } from "@features/calls/callPermissions";
import { AudioRouteIcon, AudioRouteSheet } from "@features/calls/components/AudioRouteSheet";
import { ScreenShareQualitySheet } from "@features/calls/components/ScreenShareQualitySheet";
import { ControlButton } from "@features/calls/components/ControlButton";
import type { ThemeColors } from "@theme/theme";

export function CallControls({
  T,
  canModerate,
  compact = false,
}: {
  T: ThemeColors;
  canModerate: boolean;
  compact?: boolean;
}) {
  const {
    session,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    flipCamera,
    leaveCall,
    endCallForAll,
  } = useCall();
  const { user } = useAuth();
  const call = useActiveCall(session.channelId ?? undefined);
  const canPublish = canPublishInCall(call, user?.id ?? "");
  const [qualityOpen, setQualityOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  // Gated on what the installed binary can actually do: an Android client built
  // before the media-projection permission crashes on capture, and an iOS client
  // without the broadcast extension would publish a share that never gets a frame.
  const [canShareScreen, setCanShareScreen] = useState(false);
  const { outputs, selected } = useAudioOutputs(!compact);
  const activeRoute = outputs.find((route) => route.id === selected) ?? outputs[0];
  const size = compact ? 18 : 24;

  useEffect(() => {
    void isScreenSharePermitted().then(setCanShareScreen);
  }, []);

  return (
    <>
      <View style={styles.row}>
        <ControlButton
          compact={compact}
          disabled={!canPublish}
          onPress={() => void toggleMic()}
          accessibilityHint={!canPublish ? AUDIENCE_MESSAGE : undefined}
          accessibilityLabel={session.micEnabled ? "Mute microphone" : "Unmute microphone"}
        >
          {session.micEnabled ? (
            <Microphone size={size} color={T.green} weight="fill" />
          ) : (
            <MicrophoneSlash size={size} color={T.red} weight="fill" />
          )}
        </ControlButton>
        <ControlButton
          compact={compact}
          disabled={!canPublish}
          onPress={() => void toggleCamera()}
          accessibilityHint={!canPublish ? AUDIENCE_MESSAGE : undefined}
          accessibilityLabel={session.cameraEnabled ? "Turn camera off" : "Turn camera on"}
        >
          {session.cameraEnabled ? (
            <VideoCamera size={size} color={T.green} weight="fill" />
          ) : (
            <VideoCameraSlash size={size} color={T.textDim} weight="fill" />
          )}
        </ControlButton>
        {!compact && session.cameraEnabled ? (
          <ControlButton onPress={() => void flipCamera()} accessibilityLabel="Flip camera">
            <CameraRotate size={size} color={T.text} weight="bold" />
          </ControlButton>
        ) : null}
        {!compact && canShareScreen && canPublish ? (
          <ControlButton
            onPress={() => void toggleScreenShare()}
            onLongPress={() => setQualityOpen(true)}
            accessibilityLabel={session.screenSharing ? "Stop sharing screen" : "Share screen"}
            accessibilityHint="Press and hold to choose the share quality"
          >
            {session.screenSharing ? (
              <MonitorArrowUp size={size} color={T.accent} weight="fill" />
            ) : (
              <Monitor size={size} color={T.text} weight="bold" />
            )}
          </ControlButton>
        ) : null}
        {!compact ? (
          <ControlButton
            onPress={() => setRouteOpen(true)}
            accessibilityLabel={
              activeRoute ? `Audio output: ${activeRoute.label}` : "Choose audio output"
            }
          >
            <AudioRouteIcon routeId={activeRoute?.id} size={size} color={T.text} />
          </ControlButton>
        ) : null}
        <ControlButton
          compact={compact}
          style={compact && [styles.leaveCompact, { backgroundColor: T.red }]}
          activeOpacity={0.8}
          onPress={() => {
            // Hosts choose between leaving and ending for everyone (web parity);
            // everyone else leaves immediately.
            if (canModerate && !compact) {
              Alert.alert("End call", undefined, [
                { text: "Leave call", onPress: () => void leaveCall() },
                {
                  text: "End call for everyone",
                  style: "destructive",
                  onPress: () => void endCallForAll(),
                },
                { text: "Cancel", style: "cancel" },
              ]);
              return;
            }
            void leaveCall();
          }}
          accessibilityLabel="Leave call"
        >
          <PhoneDisconnect
            size={compact ? size : 26}
            color={compact ? "#ffffff" : T.red}
            weight="fill"
          />
        </ControlButton>
      </View>
      <ScreenShareQualitySheet visible={qualityOpen} onClose={() => setQualityOpen(false)} />
      <AudioRouteSheet visible={routeOpen} onClose={() => setRouteOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  leaveCompact: { borderWidth: 0 },
});
