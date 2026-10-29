import { useAppSelector } from "@/app/hooks";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useCall } from "@/features/calls/components/callContext";
import { selectCallSession } from "@/features/calls/store/callsSlice";
import { CALL_END_COPY } from "@/features/calls/utils/callErrors";

export function CallConnectionLostModal() {
  const { rejoin, leaveCurrentCall } = useCall();
  const session = useAppSelector(selectCallSession);

  if (session.status !== "disconnected") return null;
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
