import { useEffect, useMemo } from "react";
import { ConnectionState } from "livekit-client";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useCall } from "@/features/calls/components/callContext";
import {
  feedbackChanged,
  prejoinOpened,
  ringDismissed,
  selectCallSession,
  selectRingInvites,
} from "@/features/calls/store/callsSlice";
import { declineCall } from "@/features/calls/store/callsThunks";
import { createHoldToTalk } from "@/features/calls/utils/holdToTalk";
import { callErrorMessage } from "@/features/calls/utils/callErrors";
import {
  isEditableTarget,
  matchesShortcut,
  useKeybinding,
  useShortcutHandlers,
} from "@/features/settings/hooks/useKeyboardShortcuts";

export function CallShortcuts() {
  const dispatch = useAppDispatch();
  const { room, popoutWindow, toggleMic, toggleCamera, leaveCurrentCall } = useCall();
  const session = useAppSelector(selectCallSession);
  const invites = useAppSelector(selectRingInvites);
  const binding = useKeybinding("calls.pushToTalk");
  const connected = session.status === "connected";
  const handlers = useMemo(() => {
    const actions: Record<string, () => void> = {};
    if (connected) {
      actions["calls.mute"] = () => {
        void toggleMic();
      };
      actions["calls.camera"] = () => {
        void toggleCamera();
      };
    }
    if (session.status !== "idle")
      actions["calls.leave"] = () => {
        void leaveCurrentCall();
      };
    if (session.status === "idle" && invites.length) {
      const invite = invites[0];
      const current = () => !invite.expiresAt || Date.parse(invite.expiresAt) > Date.now();
      actions["calls.answer"] = () => {
        if (!current()) return;
        dispatch(ringDismissed(invite.callId));
        dispatch(prejoinOpened({ channelId: invite.channelId, callId: invite.callId }));
      };
      actions["calls.decline"] = () => {
        if (current()) void dispatch(declineCall(invite.callId));
      };
    }
    return actions;
  }, [connected, session.status, invites, dispatch, toggleMic, toggleCamera, leaveCurrentCall]);
  useShortcutHandlers(handlers, { ignoreRepeat: true });
  useShortcutHandlers(handlers, {
    targetWindow: popoutWindow ?? window,
    enabled: !!popoutWindow,
    ignoreRepeat: true,
  });

  const hold = useMemo(
    () =>
      createHoldToTalk(async (enabled) => {
        if (
          !room ||
          room.state !== ConnectionState.Connected ||
          (enabled && room.localParticipant.permissions?.canPublish === false)
        )
          return;
        try {
          await room.localParticipant.setMicrophoneEnabled(enabled);
        } catch (error) {
          dispatch(feedbackChanged(callErrorMessage(error, "microphone")));
        }
      }),
    [room, dispatch],
  );

  useEffect(() => {
    if (!room || !connected || !binding) return;
    const targets = popoutWindow ? [window, popoutWindow] : [window];
    let code: string | null = null;
    const release = () => {
      code = null;
      void hold.release();
    };
    const down = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        isEditableTarget(event.target) ||
        (event.target as HTMLElement | null)?.closest?.(
          "button, a[href], [role=button], [role=slider]",
        )
      )
        return;
      if (!matchesShortcut(event, binding) || room.localParticipant.isMicrophoneEnabled) return;
      event.preventDefault();
      code = event.code || event.key;
      void hold.press(true);
    };
    const up = (event: KeyboardEvent) => {
      if (code !== (event.code || event.key)) return;
      event.preventDefault();
      release();
    };
    const cleanups = targets.map((targetWindow) => {
      const visibility = () => {
        if (targetWindow.document.hidden) release();
      };
      targetWindow.addEventListener("keydown", down);
      targetWindow.addEventListener("keyup", up);
      targetWindow.addEventListener("blur", release);
      targetWindow.document.addEventListener("visibilitychange", visibility);
      return () => {
        targetWindow.removeEventListener("keydown", down);
        targetWindow.removeEventListener("keyup", up);
        targetWindow.removeEventListener("blur", release);
        targetWindow.document.removeEventListener("visibilitychange", visibility);
      };
    });
    return () => {
      release();
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [room, connected, binding, hold, popoutWindow]);
  return null;
}
