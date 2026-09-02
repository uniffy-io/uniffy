import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MicrophoneSlash, PushPinSlash, Users } from "phosphor-react-native";
import type { Participant } from "livekit-client";
import { loadLivekitClient } from "@features/calls/livekit";
import { useCall } from "@features/calls/CallContext";
import { useAuth } from "@core/providers/AuthContext";
import { useActiveCall } from "@features/calls/useCallsState";
import { useRoomParticipants } from "@features/calls/useRoomParticipants";
import { useChannels } from "@features/chat/useChat";
import { useCameraFit } from "@features/calls/callPrefs";
import { callsApi } from "@features/calls/callsApi";
import { formatCallDuration } from "@features/calls/callsSerializer";
import { ParticipantTile, participantLabel } from "@features/calls/components/ParticipantTile";
import { DraggablePip } from "@features/calls/components/DraggablePip";
import { CallControls } from "@features/calls/components/CallControls";
import { CallParticipantsSheet } from "@features/calls/components/CallParticipantsSheet";
import { ZoomableStage } from "@features/calls/components/ZoomableStage";
import { DomainHeader } from "@shared/components/DomainHeader";
import { GlassSurface } from "@shared/components/GlassSurface";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

const SOLO_HINT_AFTER_MS = 60 * 1000;
const PIP_WIDTH = 108;
const PIP_HEIGHT = 150;
const GRID_GAP = 10;
// The strip is laid out from these rather than left to size itself: it sits
// beside a flex:1 stage, and a self-sizing ScrollView splits the leftover
// space with that stage instead of yielding it, which strands the grid
// halfway up the screen behind a band of dead air.
const STRIP_TILE_WIDTH = 104;
const STRIP_TILE_HEIGHT = 76;

const livekit = loadLivekitClient();

/** Which participant, and which of their tracks, is on the stage. */
interface FocusTarget {
  identity: string;
  source: "camera" | "screen";
}

function sameTarget(a: FocusTarget | null, b: FocusTarget): boolean {
  return !!a && a.identity === b.identity && a.source === b.source;
}

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
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });
  const [pipStage, setPipStage] = useState({ width: 0, height: 0 });
  const [pinned, setPinned] = useState<FocusTarget | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);
  const { user, organizationId } = useAuth();
  const { session, room, setMinimized } = useCall();
  const activeCall = useActiveCall(session.channelId ?? undefined);
  const participants = useRoomParticipants(room);
  const { channels } = useChannels();
  const [cameraFit] = useCameraFit();
  // Only the local view follows the preference; a remote tile is framed by
  // whoever is sending it.
  const localFit = cameraFit === "fit" ? "contain" : "cover";

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

  const screenShares = useMemo(
    () =>
      participants.filter((p) => {
        if (!livekit) return false;
        const pub = p.getTrackPublication(livekit.Track.Source.ScreenShare);
        return !!pub?.track && !pub.isMuted && (p.isLocal || pub.isSubscribed);
      }),
    // Roster hook re-renders on track events, so this stays fresh.
    [participants],
  );

  // A pin survives roster churn only while its target is still publishing what
  // was pinned; a screen share that ends must fall back rather than hold the
  // stage on a dead track.
  const pinnedValid =
    pinned !== null &&
    participants.some(
      (p) =>
        p.identity === pinned.identity &&
        (pinned.source === "camera" || screenShares.some((s) => s.identity === p.identity)),
    );

  // Matches the web call view: an explicit pin wins, otherwise a live screen
  // share takes the stage on its own.
  const focus: FocusTarget | null = pinnedValid
    ? pinned
    : screenShares.length > 0
      ? { identity: screenShares[0].identity, source: "screen" }
      : null;

  const focusedParticipant = focus
    ? participants.find((p) => p.identity === focus.identity)
    : undefined;

  const togglePin = useCallback((target: FocusTarget) => {
    setPinned((prev) => (sameTarget(prev, target) ? null : target));
  }, []);

  // Shared screens lead the strip so they stay reachable once a camera is
  // pinned over them.
  const strip = useMemo(
    () => [
      ...screenShares.map((p) => ({
        participant: p,
        target: { identity: p.identity, source: "screen" as const },
      })),
      ...participants.map((p) => ({
        participant: p,
        target: { identity: p.identity, source: "camera" as const },
      })),
    ],
    [screenShares, participants],
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
  // Both tile axes derive from the scroll viewport the tiles actually sit in,
  // never from the stage around it: onLayout reports a padded box, so dividing
  // the stage oversized every row by its own padding and pushed the last one
  // under the controls. Measuring the viewport also survives any later change
  // to that padding.
  const gridColumns = participants.length <= 4 ? 2 : 3;
  // Rows are capped rather than divided out: past three the tiles shrink below
  // the point where a face is readable, so the grid scrolls instead.
  const gridRows = Math.min(Math.ceil(participants.length / gridColumns), 3);
  // Floored so a sub-pixel remainder cannot push the last column onto its own
  // row, which would strand a tile below the fold.
  const gridTile =
    gridSize.width > 0 && gridSize.height > 0
      ? {
          width: Math.floor((gridSize.width - GRID_GAP * (gridColumns - 1)) / gridColumns),
          height: Math.floor((gridSize.height - GRID_GAP * (gridRows - 1)) / gridRows),
        }
      : null;

  // 1:1 uses a picture-in-picture stage: the other person fills the frame, the
  // self-view floats in a corner. Solo (nobody else yet) shows just the local
  // participant full-frame.
  const localParticipant = participants.find((p) => p.isLocal);
  const remoteParticipant = participants.find((p) => !p.isLocal);
  const heroParticipant = remoteParticipant ?? localParticipant;

  return (
    <View style={[styles.root, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={channelTitle}
        subtitle={status}
        color={T.green}
        icon="chat"
        onBack={() => setMinimized(true)}
        rightActions={
          <TouchableOpacity
            style={styles.rosterButton}
            onPress={() => setRosterOpen(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Participants, ${participants.length}`}
          >
            <Users size={18} color={T.textDim} weight="bold" />
            <Text style={[styles.rosterCount, { color: T.textDim }]}>{participants.length}</Text>
          </TouchableOpacity>
        }
      />

      {session.status === "reconnecting" ? (
        <View
          style={[styles.banner, { backgroundColor: T.surface, borderColor: T.border }]}
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.bannerText, { color: T.textDim }]}>
            Connection lost - reconnecting
          </Text>
        </View>
      ) : null}
      {session.secondDeviceMuted ? (
        <View
          style={[styles.banner, { backgroundColor: T.surface, borderColor: T.border }]}
          accessibilityLiveRegion="polite"
        >
          <MicrophoneSlash size={13} color={T.textDim} weight="fill" />
          <Text style={[styles.bannerText, { color: T.textDim }]}>
            Joined on a second device - mic muted
          </Text>
        </View>
      ) : null}

      <View style={styles.stage}>
        {focus && focusedParticipant ? (
          <View style={styles.focusLayout}>
            <View style={styles.focusStage}>
              {focus.source === "screen" ? (
                <ZoomableStage trackKey={`${focus.identity}:screen`}>
                  <ParticipantTile
                    participant={focusedParticipant}
                    T={T}
                    source={livekit?.Track.Source.ScreenShare}
                    style={styles.fillTile}
                  />
                </ZoomableStage>
              ) : (
                <ParticipantTile participant={focusedParticipant} T={T} style={styles.fillTile} />
              )}
              {pinnedValid ? (
                <Pressable
                  style={styles.unpinChip}
                  onPress={() => setPinned(null)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Unpin"
                >
                  <PushPinSlash size={12} color="#ffffff" weight="fill" />
                  <Text style={styles.unpinLabel}>Unpin</Text>
                </Pressable>
              ) : null}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.strip}
              contentContainerStyle={styles.stripContent}
            >
              {strip.map(({ participant, target }) => (
                <Pressable
                  key={`${target.identity}:${target.source}`}
                  onPress={() => togglePin(target)}
                  onLongPress={() => hostActionsFor(participant)}
                  accessibilityRole="button"
                  accessibilityLabel={`${sameTarget(focus, target) ? "Unpin" : "Pin"} ${participantLabel(participant)}${
                    target.source === "screen" ? "'s screen" : ""
                  }`}
                >
                  <ParticipantTile
                    participant={participant}
                    T={T}
                    compact
                    source={
                      target.source === "screen" ? livekit?.Track.Source.ScreenShare : undefined
                    }
                    style={[
                      styles.stripTile,
                      sameTarget(focus, target) && { borderColor: T.accent, borderWidth: 2 },
                    ]}
                  />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : participants.length <= 2 ? (
          <View
            style={styles.pipLayout}
            onLayout={(e) =>
              setPipStage({
                width: e.nativeEvent.layout.width,
                height: e.nativeEvent.layout.height,
              })
            }
          >
            {heroParticipant ? (
              <Pressable
                style={styles.fillTile}
                onLongPress={() => hostActionsFor(heroParticipant)}
                accessibilityLabel={participantLabel(heroParticipant)}
              >
                <ParticipantTile
                  participant={heroParticipant}
                  T={T}
                  style={styles.fillTile}
                  fit={heroParticipant.isLocal ? localFit : undefined}
                />
              </Pressable>
            ) : null}
            {remoteParticipant && localParticipant ? (
              <DraggablePip
                containerWidth={pipStage.width}
                containerHeight={pipStage.height}
                width={PIP_WIDTH}
                height={PIP_HEIGHT}
              >
                <ParticipantTile
                  participant={localParticipant}
                  T={T}
                  compact
                  style={styles.fillTile}
                  fit={localFit}
                />
              </DraggablePip>
            ) : null}
          </View>
        ) : (
          <ScrollView
            style={styles.gridScroll}
            contentContainerStyle={styles.gridLayout}
            onLayout={(e) =>
              setGridSize({
                width: e.nativeEvent.layout.width,
                height: e.nativeEvent.layout.height,
              })
            }
          >
            {participants.map((p) => (
              <Pressable
                key={p.identity}
                style={gridTile ?? styles.gridTilePending}
                onPress={() => togglePin({ identity: p.identity, source: "camera" })}
                onLongPress={() => hostActionsFor(p)}
                accessibilityRole="button"
                accessibilityLabel={`Pin ${participantLabel(p)}`}
              >
                <ParticipantTile
                  participant={p}
                  T={T}
                  style={styles.fillTile}
                  fit={p.isLocal ? localFit : undefined}
                />
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

      <CallParticipantsSheet
        visible={rosterOpen}
        onClose={() => setRosterOpen(false)}
        participants={participants}
        isHost={isHost}
      />
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
  fillTile: { flex: 1 },
  pipLayout: { flex: 1 },
  // flex:1 so the viewport it reports is the real space available, not the
  // height of whatever it currently holds.
  gridScroll: { flex: 1 },
  gridLayout: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  // Holds the shape for the single frame before onLayout reports the stage box.
  gridTilePending: { width: "48%", aspectRatio: 1 },
  focusLayout: { flex: 1, gap: 10 },
  focusStage: { flex: 1 },
  // flexGrow:0 keeps the strip at its tile height so the stage above claims
  // every remaining pixel.
  strip: { height: STRIP_TILE_HEIGHT, flexGrow: 0 },
  stripContent: { gap: 8 },
  stripTile: { width: STRIP_TILE_WIDTH, height: STRIP_TILE_HEIGHT },
  unpinChip: {
    position: "absolute",
    right: 8,
    top: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  unpinLabel: { fontSize: 11, fontFamily: FONT.medium, color: "#ffffff" },
  soloWrap: { alignItems: "center", paddingVertical: 6 },
  soloText: { fontSize: 12, fontFamily: FONT.regular },
  rosterButton: { flexDirection: "row", alignItems: "center", gap: 4 },
  rosterCount: { fontSize: 12, fontFamily: FONT.semibold, fontVariant: ["tabular-nums"] },
  controls: {
    marginHorizontal: 14,
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
});
