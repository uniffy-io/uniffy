import React from "react";
import { View, TouchableOpacity, StyleSheet, Platform, Alert } from "react-native";
import * as Haptics from "expo-haptics";
import {
  Microphone,
  MicrophoneSlash,
  VideoCamera,
  VideoCameraSlash,
  CameraRotate,
  SpeakerHigh,
  SpeakerSlash,
  PhoneDisconnect,
} from "phosphor-react-native";
import { useCall } from "@features/calls/CallContext";
import type { ThemeColors } from "@theme/theme";

function tick() {
  if (Platform.OS === "web") return;
  Haptics.selectionAsync().catch(() => {});
}

export function CallControls({
  T,
  isHost,
  compact = false,
}: {
  T: ThemeColors;
  isHost: boolean;
  compact?: boolean;
}) {
  const { session, toggleMic, toggleCamera, flipCamera, toggleSpeaker, leaveCall, endCallForAll } =
    useCall();
  const size = compact ? 18 : 24;
  // Full-screen controls are flat icons so six of them fit any phone width;
  // the dock keeps its circular buttons for contrast against chat content.
  const buttonStyle = compact
    ? [styles.button, styles.buttonCompact, { backgroundColor: T.surface, borderColor: T.border }]
    : [styles.button, styles.buttonFlat];

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <TouchableOpacity
        style={buttonStyle}
        onPress={() => {
          tick();
          void toggleMic();
        }}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={session.micEnabled ? "Mute microphone" : "Unmute microphone"}
      >
        {session.micEnabled ? (
          <Microphone size={size} color={T.green} weight="fill" />
        ) : (
          <MicrophoneSlash size={size} color={T.red} weight="fill" />
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={buttonStyle}
        onPress={() => {
          tick();
          void toggleCamera();
        }}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={session.cameraEnabled ? "Turn camera off" : "Turn camera on"}
      >
        {session.cameraEnabled ? (
          <VideoCamera size={size} color={T.green} weight="fill" />
        ) : (
          <VideoCameraSlash size={size} color={T.textDim} weight="fill" />
        )}
      </TouchableOpacity>
      {!compact && session.cameraEnabled ? (
        <TouchableOpacity
          style={buttonStyle}
          onPress={() => void flipCamera()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Flip camera"
        >
          <CameraRotate size={size} color={T.text} weight="bold" />
        </TouchableOpacity>
      ) : null}
      {!compact ? (
        <TouchableOpacity
          style={buttonStyle}
          onPress={() => void toggleSpeaker()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={session.speakerOn ? "Use earpiece" : "Use speaker"}
        >
          {session.speakerOn ? (
            <SpeakerHigh size={size} color={T.text} weight="fill" />
          ) : (
            <SpeakerSlash size={size} color={T.textDim} weight="fill" />
          )}
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        style={
          compact
            ? [styles.button, styles.buttonCompact, styles.leaveButton, { backgroundColor: T.red }]
            : [styles.button, styles.buttonFlat]
        }
        onPress={() => {
          tick();
          // Hosts choose between leaving and ending for everyone (web parity);
          // everyone else leaves immediately.
          if (isHost && !compact) {
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
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Leave call"
      >
        <PhoneDisconnect
          size={compact ? size : 26}
          color={compact ? "#ffffff" : T.red}
          weight="fill"
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  rowCompact: { gap: 8 },
  button: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonFlat: { borderWidth: 0 },
  buttonCompact: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  leaveButton: { borderWidth: 0 },
});
