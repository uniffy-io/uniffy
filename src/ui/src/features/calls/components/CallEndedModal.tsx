import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useCall } from '@/features/calls/components/callContext';
import {
  endedInfoCleared,
  selectCallSession,
  selectEndedInfo,
  sessionReset,
} from '@/features/calls/store/callsSlice';
import type { CallEndReason } from '@/features/calls/types';

const END_REASON_COPY: Record<CallEndReason, string> = {
  HOST_ENDED: 'The host ended the call.',
  ALL_LEFT: 'Everyone left the call.',
  MAX_DURATION: 'The call reached its maximum duration.',
  SOLO_TIMEOUT: 'The call ended because you were alone for a while.',
  CHANNEL_ARCHIVED: 'The call ended because the channel was archived.',
};

export function CallEndedModal() {
  const dispatch = useAppDispatch();
  const { rejoin, leaveCurrentCall } = useCall();
  const session = useAppSelector(selectCallSession);
  const endedInfo = useAppSelector(selectEndedInfo);

  if (endedInfo) {
    return (
      <Modal
        onClose={() => {
          dispatch(endedInfoCleared());
          dispatch(sessionReset());
        }}
        maxWidth="max-w-sm"
      >
        <div className="p-5 space-y-4" data-testid="call-ended-modal">
          <h2 className="text-base font-semibold text-foreground">Call ended</h2>
          <p className="text-sm text-muted-foreground">
            {endedInfo.reason ? END_REASON_COPY[endedInfo.reason] : 'The call has ended.'}
          </p>
          <div className="flex justify-end">
            <Button
              onClick={() => {
                dispatch(endedInfoCleared());
                dispatch(sessionReset());
              }}
            >
              Close
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  if (session.status === 'disconnected') {
    return (
      <Modal onClose={() => void leaveCurrentCall()} maxWidth="max-w-sm">
        <div className="p-5 space-y-4" data-testid="call-disconnected-modal">
          <h2 className="text-base font-semibold text-foreground">Lost connection</h2>
          <p className="text-sm text-muted-foreground">
            The connection to the call could not be restored.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => void leaveCurrentCall()}>
              Leave call
            </Button>
            <Button onClick={() => void rejoin()}>Rejoin</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return null;
}
