import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import {
  Phone,
  Microphone,
  MicrophoneSlash,
  VideoCamera,
  VideoCameraSlash,
  CameraRotate,
  CaretDown,
  Check,
  ArrowsOut,
  ArrowsIn,
} from "phosphor-react-native";
import type { LocalVideoTrack } from "livekit-client";
import { useCall } from "@features/calls/CallContext";
import { useAuth } from "@core/providers/AuthContext";
import { useActiveCall } from "@features/calls/useCallsState";
import { ensureCallPermissions } from "@features/calls/callPermissions";
import { callErrorMessage } from "@features/calls/callErrors";
import {
  loadLivekitClient,
  LocalVideoPreview,
  startPreviewAudio,
  stopPreviewAudio,
} from "@features/calls/livekit";
import { AudioRouteIcon } from "@features/calls/components/AudioRouteSheet";
import { useAudioOutputs } from "@features/calls/useAudioOutputs";
import { useCameraFit } from "@features/calls/callPrefs";
import { ZoomableStage } from "@features/calls/components/ZoomableStage";
import { Avatar } from "@shared/components/Avatar";
import { BottomSheet } from "@shared/components/BottomSheet";
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
  const { user } = useAuth();
  const { joinChannelCall, joinCallById } = useCall();
  const activeCall = useActiveCall(channelId);

  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [previewTrack, setPreviewTrack] = useState<LocalVideoTrack | null>(null);
  const [routeOpen, setRouteOpen] = useState(false);
  // Routes are only enumerable once the audio session is actually running, so the
  // query waits on this rather than racing the start.
  const [audioReady, setAudioReady] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The call starts its own audio session on the join path; tearing the preview's
  // down afterwards would take the live call's session with it.
  const joinedRef = useRef(false);

  const { outputs, selected, select: selectRoute } = useAudioOutputs(visible && audioReady);
  const [cameraFit, setCameraFit] = useCameraFit();
  const activeRoute = outputs.find((route) => route.id === selected) ?? outputs[0];

  // Reset the sheet each time it opens. Adjusting state during render on the
  // visible transition avoids an effect that would cascade a second render.
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setMicOn(false);
      setCameraOn(false);
      setFacing("user");
      setJoining(false);
      setError(null);
    }
  }

  useEffect(() => {
    if (!visible) return;
    joinedRef.current = false;
    let cancelled = false;
    void startPreviewAudio()
      .then(() => {
        if (!cancelled) setAudioReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      setAudioReady(false);
      if (!joinedRef.current) void stopPreviewAudio().catch(() => {});
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || !cameraOn) return;
    let cancelled = false;
    let created: LocalVideoTrack | null = null;
    void (async () => {
      const livekit = loadLivekitClient();
      if (!livekit) return;
      const granted = await ensureCallPermissions({ mic: false, camera: true });
      if (cancelled || !granted.cameraGranted) return;
      try {
        const track = await livekit.createLocalVideoTrack({ facingMode: facing });
        if (cancelled) {
          await track.stop();
          return;
        }
        created = track;
        setPreviewTrack(track);
      } catch {
        // No camera, or another app holds it; the avatar placeholder stands in.
      }
    })();
    return () => {
      cancelled = true;
      void created?.stop();
      setPreviewTrack(null);
    };
  }, [visible, cameraOn, facing]);

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
      joinedRef.current = true;
      if (callId) {
        await joinCallById(callId, channelId, media);
      } else {
        await joinChannelCall(channelId, media);
      }
      onClose();
    } catch (joinError) {
      joinedRef.current = false;
      setError(callErrorMessage(joinError));
      setJoining(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} style={styles.sheet}>
      <View style={styles.header}>
        <Phone size={18} color={T.green} weight="duotone" />
        <Text style={[styles.title, { color: T.textBright }]} numberOfLines={1}>
          {activeCall ? `Join call in ${channelName}` : `Start call in ${channelName}`}
        </Text>
      </View>

      <View style={[styles.preview, { backgroundColor: T.bg, borderColor: T.border }]}>
        {cameraOn && previewTrack ? (
          // Pinch magnifies what is on screen; it cannot widen the lens, so the
          // fit toggle beside it is what actually recovers the cropped edges.
          <ZoomableStage trackKey={`${facing}:${cameraFit}`} style={styles.previewVideo}>
            <LocalVideoPreview
              track={previewTrack}
              style={styles.previewVideo}
              objectFit={cameraFit === "fit" ? "contain" : "cover"}
              mirror={facing === "user"}
            />
          </ZoomableStage>
        ) : (
          <Avatar name={user?.fullName ?? ""} avatarUrl={user?.avatarUrl ?? undefined} size={56} />
        )}
        {cameraOn ? (
          <View style={styles.previewChips}>
            <TouchableOpacity
              style={styles.previewChip}
              onPress={() => setCameraFit(cameraFit === "fit" ? "fill" : "fit")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={
                cameraFit === "fit"
                  ? "Fill the frame, cropping the edges"
                  : "Fit the whole camera frame"
              }
            >
              {cameraFit === "fit" ? (
                <ArrowsOut size={16} color="#ffffff" weight="bold" />
              ) : (
                <ArrowsIn size={16} color="#ffffff" weight="bold" />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.previewChip}
              onPress={() => setFacing((v) => (v === "user" ? "environment" : "user"))}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={
                facing === "user" ? "Switch to the back camera" : "Switch to the front camera"
              }
            >
              <CameraRotate size={16} color="#ffffff" weight="bold" />
            </TouchableOpacity>
          </View>
        ) : null}
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

      {activeRoute ? (
        <View style={[styles.routeBox, { borderColor: T.border }]}>
          <TouchableOpacity
            style={styles.routeRow}
            onPress={() => setRouteOpen((v) => !v)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: routeOpen }}
            accessibilityLabel={`Audio output: ${activeRoute.label}. Tap to change`}
          >
            <AudioRouteIcon routeId={activeRoute.id} size={16} color={T.textDim} />
            <Text style={[styles.routeLabel, { color: T.text }]} numberOfLines={1}>
              {activeRoute.label}
            </Text>
            <CaretDown size={14} color={T.textDim} weight="bold" />
          </TouchableOpacity>
          {/* Inline rather than a nested sheet: a second Modal stacked over this
                one permanently detaches the preview's native video surface, and it
                stays black even after the track is recreated. */}
          {routeOpen
            ? outputs.map((route) => (
                <TouchableOpacity
                  key={route.id}
                  style={[styles.routeOption, { borderTopColor: T.border }]}
                  onPress={() => {
                    selectRoute(route.id);
                    setRouteOpen(false);
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected: route.id === activeRoute.id }}
                  accessibilityLabel={route.label}
                >
                  <AudioRouteIcon routeId={route.id} size={16} color={T.textDim} />
                  <Text style={[styles.routeLabel, { color: T.text }]} numberOfLines={1}>
                    {route.label}
                  </Text>
                  {route.id === activeRoute.id ? (
                    <Check size={14} color={T.green} weight="bold" />
                  ) : null}
                </TouchableOpacity>
              ))
            : null}
        </View>
      ) : null}

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
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  // The toggles and the join button run edge to edge, so the inset belongs to
  // the sheet rather than to each row.
  sheet: { paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 10 },
  title: { fontSize: 16, fontFamily: FONT.semibold, flexShrink: 1 },
  preview: {
    height: 220,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  previewVideo: { ...StyleSheet.absoluteFill },
  previewChips: { position: "absolute", right: 8, bottom: 8, flexDirection: "row", gap: 8 },
  previewChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
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
  routeBox: { marginTop: 10, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  routeOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  routeLabel: { flex: 1, fontSize: 13, fontFamily: FONT.medium },
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
