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
import { CALL_END_COPY } from "@/features/calls/utils/callErrors";

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
              {endedInfo.reason ? CALL_END_COPY[endedInfo.reason] : "The call has ended."}
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
              {navigator.onLine ? CALL_END_COPY.CONNECTION_LOST : CALL_END_COPY.NETWORK_LOST}
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
