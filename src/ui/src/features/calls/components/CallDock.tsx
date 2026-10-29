import { CallPopout } from "@/features/calls/components/CallPopout";
import { CallShortcuts } from "@/features/calls/components/CallShortcuts";
import { CallFeedback } from "@/features/calls/components/CallFeedback";
import { useCall } from "@/features/calls/components/callContext";
import { RoomAudio } from "@/features/calls/components/RoomAudio";
import { CallInviteToasts } from "@/features/calls/components/CallInviteToasts";
import { CallConnectionLostModal } from "@/features/calls/components/CallConnectionLostModal";
import { CallEndedNotice } from "@/features/calls/components/CallEndedNotice";
import { PreJoinScreen } from "@/features/calls/components/PreJoinScreen";

/** Global call chrome: audio, ringing toasts, modals. Mounts once inside CallProvider. The live-call nav pill lives in AppHeader. */
export function CallDock() {
  const { room } = useCall();
  return (
    <>
      <CallShortcuts />
      <CallPopout />
      <CallFeedback />
      <RoomAudio room={room} />
      <CallInviteToasts />
      <CallEndedNotice />
      <CallConnectionLostModal />
      <PreJoinScreen />
    </>
  );
}
