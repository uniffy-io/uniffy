import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  DotsThree,
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
  showAudioRoutePicker,
  startPreviewAudio,
  stopPreviewAudio,
} from "@features/calls/livekit";
import { AudioRouteIcon } from "@features/calls/components/AudioRouteSheet";
import { useAudioOutputs } from "@features/calls/useAudioOutputs";
import { useCameraFit } from "@features/calls/callPrefs";
import { ZoomableStage } from "@features/calls/components/ZoomableStage";
import { useChannels } from "@features/chat/useChat";
import { Avatar } from "@shared/components/Avatar";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

// Rendered in the main window as a flow child that replaces the router content,
// the same shape as CallScreen: RTCView paints no frames inside a native Modal
// on iOS, so the camera preview cannot live in a BottomSheet. Nothing may be
// stacked over it either - a Modal above the preview detaches its video surface
// for good, which is why the audio routes are an inline list.
export function PreJoinScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { prejoinTarget, closePrejoin, joinChannelCall, joinCallById, session } = useCall();
  const channelId = prejoinTarget?.channelId;
  const activeCall = useActiveCall(channelId);
  const { channels } = useChannels();
  const channel = channels.find((c) => c.id === channelId);
  const channelName = prejoinTarget?.channelName ?? channel?.displayName ?? "this channel";
  // While a call is live it owns the audio session and the camera, so the
  // preview must not start either; a different channel cannot be joined at all
  // until that call is left.
  const inCall = session.status !== "idle";
  const busyElsewhere = inCall && session.channelId !== channelId;

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

  const { outputs, selected, select: selectRoute } = useAudioOutputs(audioReady);
  const [cameraFit, setCameraFit] = useCameraFit();
  const activeRoute = outputs.find((route) => route.id === selected) ?? outputs[0];

  useEffect(() => {
    if (inCall) return;
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
  }, [inCall]);

  // The preview is released as soon as a join starts, before the call opens its
  // own camera: a device holds one capture at a time, and losing that race puts
  // the user in the call with no camera and no message. A failed join brings
  // the preview back.
  useEffect(() => {
    if (!cameraOn || inCall || joining) return;
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
  }, [cameraOn, facing, inCall, joining]);

  const others = (activeCall?.participants ?? []).filter((p) => p.userId !== user?.id);

  const join = async () => {
    if (!channelId || joining || busyElsewhere) return;
    setJoining(true);
    setError(null);
    try {
      const granted = await ensureCallPermissions({ mic: micOn, camera: cameraOn });
      const media = {
        mic: micOn && granted.micGranted,
        camera: cameraOn && granted.cameraGranted,
        facing,
      };
      if (micOn && !granted.micGranted) {
        setError("Microphone permission denied - joining listen-only");
      }
      joinedRef.current = true;
      // The live map wins over the id captured at open time: a call that started
      // while this screen was up is the one to join.
      const callId = activeCall?.id ?? prejoinTarget?.callId;
      if (callId) {
        await joinCallById(callId, channelId, media);
      } else {
        await joinChannelCall(channelId, media);
      }
      closePrejoin();
    } catch (joinError) {
      joinedRef.current = false;
      setError(callErrorMessage(joinError));
      setJoining(false);
    }
  };

  if (!prejoinTarget) return null;

  return (
    <View style={[styles.root, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={activeCall ? "Join call" : "Start call"}
        subtitle={channelName}
        color={T.green}
        icon="chat"
        onBack={closePrejoin}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 20 }]}
        keyboardShouldPersistTaps="handled"
      >
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
            <Avatar
              name={user?.fullName ?? ""}
              avatarUrl={user?.avatarUrl ?? undefined}
              size={56}
            />
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
            {/* iOS only ever reports two routes of its own; headsets, Bluetooth
                and AirPlay are chosen through the system picker. */}
            {routeOpen && Platform.OS === "ios" ? (
              <TouchableOpacity
                style={[styles.routeOption, { borderTopColor: T.border }]}
                onPress={() => {
                  setRouteOpen(false);
                  void showAudioRoutePicker().catch(() => {});
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="More outputs, opens the system audio picker"
              >
                <DotsThree size={16} color={T.textDim} weight="bold" />
                <Text style={[styles.routeLabel, { color: T.text }]} numberOfLines={1}>
                  More outputs
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {busyElsewhere ? (
          <Text style={[styles.error, { color: T.textDim }]}>
            Leave the current call before joining another
          </Text>
        ) : null}
        {error ? <Text style={[styles.error, { color: T.red }]}>{error}</Text> : null}

        <TouchableOpacity
          style={[
            styles.joinButton,
            { backgroundColor: T.green, opacity: busyElsewhere ? 0.5 : 1 },
          ]}
          onPress={() => void join()}
          disabled={joining || busyElsewhere}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ disabled: joining || busyElsewhere }}
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  body: { paddingHorizontal: 20, paddingTop: 8 },
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
