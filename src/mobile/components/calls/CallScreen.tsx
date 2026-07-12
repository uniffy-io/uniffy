import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretDown, MicrophoneSlash, SignOut } from "phosphor-react-native";
import type { Participant } from "livekit-client";
import { loadLivekitClient } from "@/lib/livekit";
import { useCall } from "@/context/call-context";
import { useAuth } from "@/context/auth-context";
import { useActiveCall } from "@/hooks/useCallsState";
import { useRoomParticipants } from "@/hooks/useRoomParticipants";
import { useChannels } from "@/hooks/useChat";
import { callsApi } from "@/api/callsApi";
import { formatCallDuration } from "@/lib/callsSerializer";
import { ParticipantTile, participantLabel } from "@/components/calls/ParticipantTile";
import { CallControls } from "@/components/calls/CallControls";
import { useTheme } from "@/hooks/useTheme";
import { FONT } from "@/constants/typography";

const CHROME_HIDE_DELAY_MS = 4000;
const SOLO_HINT_AFTER_MS = 60 * 1000;

const livekit = loadLivekitClient();

export function CallScreen() {
  // Reads mutable livekit state (screen-share publications) during render;
  // opt out of React Compiler memoization so roster changes repaint.
  "use no memo";
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { user, organizationId } = useAuth();
  const { session, room, minimized, setMinimized } = useCall();
  const activeCall = useActiveCall(session.channelId ?? undefined);
  const participants = useRoomParticipants(room);
  const { channels } = useChannels();

  const [chromeVisible, setChromeVisible] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const visible =
    (session.status === "connecting" ||
      session.status === "connected" ||
      session.status === "reconnecting") &&
    !minimized;

  useEffect(() => {
    if (!visible || session.status !== "connected") return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible, session.status]);

  useEffect(() => {
    if (!visible || !chromeVisible || session.status !== "connected") return;
    const timer = setTimeout(() => setChromeVisible(false), CHROME_HIDE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible, chromeVisible, session.status]);

  useEffect(() => {
    if (visible) setChromeVisible(true);
  }, [visible]);

  const isHost = !!user && activeCall?.hostUserId === user.id;

  const channelTitle = useMemo(() => {
    const channel = channels.find((c) => c.id === session.channelId);
    return channel ? channel.customName || channel.name || "Call" : "Call";
  }, [channels, session.channelId]);

  const screenSharer = useMemo(
    () =>
      participants.find((p) => {
        if (!livekit) return false;
        const pub = p.getTrackPublication(livekit.Track.Source.ScreenShare);
        return !!pub?.track && !pub.isMuted && (p.isLocal || pub.isSubscribed);
      }),
    // Roster hook re-renders on track events, so this stays fresh.
    [participants],
  );

  const hostActionsFor = useCallback(
    (participant: Participant) => {
      if (!isHost || participant.isLocal || !organizationId || !session.callId) return;
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
    },
    [isHost, organizationId, session.callId],
  );

  if (!visible) return null;

  const elapsed = session.connectedAtMs ? formatCallDuration(nowMs - session.connectedAtMs) : "";
  const solo =
    participants.length === 1 &&
    session.status === "connected" &&
    session.connectedAtMs > 0 &&
    nowMs - session.connectedAtMs > SOLO_HINT_AFTER_MS;
  const gridHeight = windowHeight - insets.top - insets.bottom - 220;

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: T.pageBg, paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
      pointerEvents="auto"
    >
      {chromeVisible ? (
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => setMinimized(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Minimize call"
          >
            <CaretDown size={22} color={T.text} weight="bold" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={[styles.title, { color: T.textBright }]} numberOfLines={1}>
              {channelTitle}
            </Text>
            <Text style={[styles.subtitle, { color: T.textDim }]}>
              {session.status === "connecting"
                ? "Connecting..."
                : session.status === "reconnecting"
                  ? "Reconnecting..."
                  : elapsed}
            </Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>
      ) : null}

      {session.status === "reconnecting" ? (
        <View style={[styles.banner, { backgroundColor: T.surface, borderColor: T.border }]}>
          <Text style={[styles.bannerText, { color: T.textDim }]}>
            Connection lost - reconnecting
          </Text>
        </View>
      ) : null}
      {session.secondDeviceMuted ? (
        <View style={[styles.banner, { backgroundColor: T.surface, borderColor: T.border }]}>
          <MicrophoneSlash size={13} color={T.textDim} weight="fill" />
          <Text style={[styles.bannerText, { color: T.textDim }]}>
            Joined on a second device - mic muted
          </Text>
        </View>
      ) : null}

      <Pressable style={styles.stage} onPress={() => setChromeVisible((v) => !v)}>
        {screenSharer ? (
          <View style={styles.screenShareLayout}>
            <ParticipantTile
              participant={screenSharer}
              T={T}
              source={livekit?.Track.Source.ScreenShare}
              style={styles.screenStage}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filmstrip}
            >
              {participants.map((p) => (
                <Pressable key={p.identity} onLongPress={() => hostActionsFor(p)}>
                  <ParticipantTile participant={p} T={T} compact style={styles.filmstripTile} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : participants.length <= 2 ? (
          <View style={styles.stackLayout}>
            {participants.map((p) => (
              <Pressable
                key={p.identity}
                style={styles.stackTile}
                onLongPress={() => hostActionsFor(p)}
              >
                <ParticipantTile participant={p} T={T} style={styles.fillTile} />
              </Pressable>
            ))}
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.gridLayout}>
            {participants.map((p) => (
              <Pressable
                key={p.identity}
                style={[
                  styles.gridTile,
                  { height: participants.length <= 4 ? gridHeight / 2 - 6 : gridHeight / 3 },
                ]}
                onLongPress={() => hostActionsFor(p)}
              >
                <ParticipantTile participant={p} T={T} style={styles.fillTile} />
              </Pressable>
            ))}
          </ScrollView>
        )}
      </Pressable>

      {solo ? (
        <View style={styles.soloWrap}>
          <Text style={[styles.soloText, { color: T.textDim }]}>
            You are the only one here - the call ends after 5 minutes alone
          </Text>
        </View>
      ) : null}

      {chromeVisible ? (
        <View style={styles.controls}>
          <CallControls T={T} isHost={isHost} />
        </View>
      ) : null}
      {!chromeVisible ? (
        <TouchableOpacity
          style={[styles.leaveGhost, { bottom: insets.bottom + 18, backgroundColor: T.surface }]}
          onPress={() => setChromeVisible(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Show call controls"
        >
          <SignOut size={16} color={T.textDim} weight="bold" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 300 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerSpacer: { width: 22 },
  title: { fontSize: 16, fontFamily: FONT.semibold },
  subtitle: { fontSize: 12, fontFamily: FONT.regular, marginTop: 1 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
  },
  bannerText: { fontSize: 12, fontFamily: FONT.medium },
  stage: { flex: 1, paddingHorizontal: 10 },
  stackLayout: { flex: 1, gap: 10 },
  stackTile: { flex: 1 },
  fillTile: { flex: 1 },
  gridLayout: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  gridTile: { width: "48.5%" },
  screenShareLayout: { flex: 1, gap: 10 },
  screenStage: { flex: 1 },
  filmstrip: { gap: 8, paddingVertical: 2 },
  filmstripTile: { width: 96, height: 72 },
  soloWrap: { alignItems: "center", paddingVertical: 6 },
  soloText: { fontSize: 12, fontFamily: FONT.regular },
  controls: { paddingTop: 12, paddingBottom: 12 },
  leaveGhost: {
    position: "absolute",
    alignSelf: "center",
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.85,
  },
});
