import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MicrophoneSlash } from "phosphor-react-native";
import type { Participant } from "livekit-client";
import { loadLivekitClient } from "@features/calls/livekit";
import { useCall } from "@features/calls/CallContext";
import { useAuth } from "@core/providers/AuthContext";
import { useActiveCall } from "@features/calls/useCallsState";
import { useRoomParticipants } from "@features/calls/useRoomParticipants";
import { useChannels } from "@features/chat/useChat";
import { callsApi } from "@features/calls/callsApi";
import { formatCallDuration } from "@features/calls/callsSerializer";
import { ParticipantTile, participantLabel } from "@features/calls/components/ParticipantTile";
import { CallControls } from "@features/calls/components/CallControls";
import { DomainHeader } from "@shared/components/DomainHeader";
import { GlassSurface } from "@shared/components/GlassSurface";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

const SOLO_HINT_AFTER_MS = 60 * 1000;

const livekit = loadLivekitClient();

// Rendered in the main window as a flow child that replaces the router
// content while expanded: RTCView paints no frames in native modals or
// FullWindowOverlay on iOS, and inset-positioned shell overlays get
// flow-laid on iOS 26 Fabric, so neither presentation works here.
export function CallScreen() {
  // Reads mutable livekit state (screen-share publications) during render;
  // opt out of React Compiler memoization so roster changes repaint.
  "use no memo";
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { user, organizationId } = useAuth();
  const { session, room, setMinimized } = useCall();
  const activeCall = useActiveCall(session.channelId ?? undefined);
  const participants = useRoomParticipants(room);
  const { channels } = useChannels();

  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (session.status !== "connected") return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session.status]);

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

  const elapsed = session.connectedAtMs ? formatCallDuration(nowMs - session.connectedAtMs) : "";
  const status =
    session.status === "connecting"
      ? "Connecting..."
      : session.status === "reconnecting"
        ? "Reconnecting..."
        : elapsed;
  const solo =
    participants.length === 1 &&
    session.status === "connected" &&
    session.connectedAtMs > 0 &&
    nowMs - session.connectedAtMs > SOLO_HINT_AFTER_MS;
  const gridHeight = windowHeight - insets.top - insets.bottom - 220;

  return (
    <View style={[styles.root, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={channelTitle}
        subtitle={status}
        color={T.green}
        icon="chat"
        onBack={() => setMinimized(true)}
      />

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

      <View style={styles.stage}>
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
      </View>

      {solo ? (
        <View style={styles.soloWrap}>
          <Text style={[styles.soloText, { color: T.textDim }]}>
            You are the only one here - the call ends after 5 minutes alone
          </Text>
        </View>
      ) : null}

      <View style={[styles.controls, { borderColor: T.border, marginBottom: insets.bottom + 10 }]}>
        <GlassSurface
          style={StyleSheet.absoluteFill}
          tintColor={T.isDark ? "rgba(20,22,34,0.22)" : "rgba(255,255,255,0.35)"}
          interactive
          isDark={T.isDark}
          blurIntensity={48}
          solidColor={T.surface}
        />
        <CallControls T={T} isHost={isHost} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
    marginTop: 8,
  },
  bannerText: { fontSize: 12, fontFamily: FONT.medium },
  stage: { flex: 1, paddingHorizontal: 10, paddingTop: 10 },
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
  controls: {
    marginHorizontal: 14,
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
});
