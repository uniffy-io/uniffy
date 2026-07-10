import { useCall } from '@/features/calls/components/callContext';
import { RoomAudio } from '@/features/calls/components/RoomAudio';
import { CallBottomStrip } from '@/features/calls/components/CallBottomStrip';
import { CallInviteToasts } from '@/features/calls/components/CallInviteToasts';
import { CallEndedModal } from '@/features/calls/components/CallEndedModal';
import { PreJoinScreen } from '@/features/calls/components/PreJoinScreen';

/** Global call chrome: audio, bottom strip, ringing toasts, modals. Mounts once inside CallProvider. */
export function CallDock() {
  const { room } = useCall();
  return (
    <>
      <RoomAudio room={room} />
      <CallBottomStrip />
      <CallInviteToasts />
      <CallEndedModal />
      <PreJoinScreen />
    </>
  );
}
