import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal, ActivityIndicator } from "react-native";
import {
  Phone,
  Microphone,
  MicrophoneSlash,
  VideoCamera,
  VideoCameraSlash,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCall } from "@features/calls/CallContext";
import { useAuth } from "@core/providers/AuthContext";
import { useActiveCall } from "@features/calls/useCallsState";
import { ensureCallPermissions } from "@features/calls/callPermissions";
import { callErrorMessage } from "@features/calls/callErrors";
import { Avatar } from "@shared/components/Avatar";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";

export function PreJoinSheet({
  visible,
  T,
  channelId,
  channelName,
  callId,
  onClose,
}: {
  visible: boolean;
  T: ThemeColors;
  channelId: string;
  channelName: string;
  /** Join this specific call (ring accept); otherwise start/join via the channel. */
  callId?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { joinChannelCall, joinCallById } = useCall();
  const activeCall = useActiveCall(channelId);

  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the sheet each time it opens. Adjusting state during render on the
  // visible transition avoids an effect that would cascade a second render.
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setMicOn(false);
      setCameraOn(false);
      setJoining(false);
      setError(null);
    }
  }

  const others = (activeCall?.participants ?? []).filter((p) => p.userId !== user?.id);

  const join = async () => {
    if (joining) return;
    setJoining(true);
    setError(null);
    try {
      const granted = await ensureCallPermissions({ mic: micOn, camera: cameraOn });
      const media = {
        mic: micOn && granted.micGranted,
        camera: cameraOn && granted.cameraGranted,
      };
      if (micOn && !granted.micGranted) {
        setError("Microphone permission denied - joining listen-only");
      }
      if (callId) {
        await joinCallById(callId, channelId, media);
      } else {
        await joinChannelCall(channelId, media);
      }
      onClose();
    } catch (joinError) {
      setError(callErrorMessage(joinError));
      setJoining(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: T.surface, paddingBottom: Math.max(32, insets.bottom + 16) },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: T.border }]} />
        <View style={styles.header}>
          <Phone size={18} color={T.green} weight="duotone" />
          <Text style={[styles.title, { color: T.textBright }]} numberOfLines={1}>
            {activeCall ? `Join call in ${channelName}` : `Start call in ${channelName}`}
          </Text>
        </View>

        {others.length > 0 ? (
          <View style={styles.rosterRow}>
            <View style={styles.rosterAvatars}>
              {others.slice(0, 5).map((p) => (
                <View key={p.identity} style={styles.rosterAvatar}>
                  <Avatar name={p.displayName} avatarUrl={p.avatarUrl ?? undefined} size={28} />
                </View>
              ))}
            </View>
            <Text style={[styles.rosterText, { color: T.textDim }]} numberOfLines={1}>
              {others.length === 1
                ? `${others[0].displayName} is here`
                : `${others.length} people are here`}
            </Text>
          </View>
        ) : (
          <Text style={[styles.rosterText, { color: T.textDim }]}>
            No one here yet - members get notified when you start
          </Text>
        )}

        <View style={styles.toggles}>
          <TouchableOpacity
            style={[
              styles.toggle,
              { backgroundColor: T.bg, borderColor: micOn ? T.green : T.border },
            ]}
            onPress={() => setMicOn((v) => !v)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={micOn ? "Join with microphone off" : "Join with microphone on"}
          >
            {micOn ? (
              <Microphone size={18} color={T.green} weight="fill" />
            ) : (
              <MicrophoneSlash size={18} color={T.textDim} weight="fill" />
            )}
            <Text style={[styles.toggleLabel, { color: micOn ? T.textBright : T.textDim }]}>
              Mic {micOn ? "on" : "off"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggle,
              { backgroundColor: T.bg, borderColor: cameraOn ? T.green : T.border },
            ]}
            onPress={() => setCameraOn((v) => !v)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={cameraOn ? "Join with camera off" : "Join with camera on"}
          >
            {cameraOn ? (
              <VideoCamera size={18} color={T.green} weight="fill" />
            ) : (
              <VideoCameraSlash size={18} color={T.textDim} weight="fill" />
            )}
            <Text style={[styles.toggleLabel, { color: cameraOn ? T.textBright : T.textDim }]}>
              Camera {cameraOn ? "on" : "off"}
            </Text>
          </TouchableOpacity>
        </View>

        {error ? <Text style={[styles.error, { color: T.red }]}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.joinButton, { backgroundColor: T.green }]}
          onPress={() => void join()}
          disabled={joining}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Join call"
        >
          {joining ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Phone size={17} color="#ffffff" weight="fill" />
              <Text style={styles.joinLabel}>{activeCall ? "Join call" : "Start call"}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 10,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 10 },
  title: { fontSize: 16, fontFamily: FONT.semibold, flexShrink: 1 },
  rosterRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 4 },
  rosterAvatars: { flexDirection: "row" },
  rosterAvatar: { marginRight: -8 },
  rosterText: { fontSize: 13, fontFamily: FONT.regular, paddingBottom: 4, flexShrink: 1 },
  toggles: { flexDirection: "row", gap: 10, paddingTop: 12 },
  toggle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  toggleLabel: { fontSize: 13, fontFamily: FONT.medium },
  error: { fontSize: 12, fontFamily: FONT.regular, paddingTop: 10 },
  joinButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 16,
  },
  joinLabel: { fontSize: 15, fontFamily: FONT.semibold, color: "#ffffff" },
});
