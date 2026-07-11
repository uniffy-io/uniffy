import { useCall } from '@/features/calls/components/callContext';
import { RoomAudio } from '@/features/calls/components/RoomAudio';
import { CallInviteToasts } from '@/features/calls/components/CallInviteToasts';
import { CallEndedModal } from '@/features/calls/components/CallEndedModal';
import { PreJoinScreen } from '@/features/calls/components/PreJoinScreen';

/** Global call chrome: audio, ringing toasts, modals. Mounts once inside CallProvider. The live-call nav pill lives in AppHeader. */
export function CallDock() {
  const { room } = useCall();
  return (
    <>
      <RoomAudio room={room} />
      <CallInviteToasts />
      <CallEndedModal />
      <PreJoinScreen />
    </>
  );
}
