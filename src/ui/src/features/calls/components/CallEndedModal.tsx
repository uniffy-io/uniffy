import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useCall } from "@/features/calls/components/callContext";
import {
  endedInfoCleared,
  selectCallSession,
  selectEndedInfo,
  sessionReset,
} from "@/features/calls/store/callsSlice";
import type { CallEndReason } from "@/features/calls/types";

const END_REASON_COPY: Record<CallEndReason, string> = {
  HOST_ENDED: "The host ended the call.",
  ALL_LEFT: "Everyone left the call.",
  MAX_DURATION: "The call reached its maximum duration.",
  SOLO_TIMEOUT: "The call ended because you were alone for a while.",
  CHANNEL_ARCHIVED: "The call ended because the channel was archived.",
  ORG_SUSPENDED: "The call ended because the organization was suspended.",
  ORG_DELETED: "The call ended because the organization was deleted.",
};

export function CallEndedModal() {
  const dispatch = useAppDispatch();
  const { rejoin, leaveCurrentCall } = useCall();
  const session = useAppSelector(selectCallSession);
  const endedInfo = useAppSelector(selectEndedInfo);

  if (endedInfo) {
    const dismiss = () => {
      dispatch(endedInfoCleared());
      dispatch(sessionReset());
    };
    return (
      <Modal onClose={dismiss} maxWidth="max-w-sm">
        <div data-testid="call-ended-modal">
          <ModalHeader title="Call ended" />
          <ModalBody>
            <p className="text-sm text-muted-foreground">
              {endedInfo.reason ? END_REASON_COPY[endedInfo.reason] : "The call has ended."}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button onClick={dismiss}>Close</Button>
          </ModalFooter>
        </div>
      </Modal>
    );
  }

  if (session.status === "disconnected") {
    return (
      <Modal onClose={() => void leaveCurrentCall()} maxWidth="max-w-sm">
        <div data-testid="call-disconnected-modal">
          <ModalHeader title="Lost connection" />
          <ModalBody>
            <p className="text-sm text-muted-foreground">
              The connection to the call could not be restored.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => void leaveCurrentCall()}>
              Leave call
            </Button>
            <Button onClick={() => void rejoin()}>Rejoin</Button>
          </ModalFooter>
        </div>
      </Modal>
    );
  }

  return null;
}
