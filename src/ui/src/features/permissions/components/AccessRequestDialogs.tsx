import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { RequestAccessDialog } from "@/features/permissions/components/RequestAccessDialog";
import { AccessRequestReviewDialog } from "@/features/permissions/components/AccessRequestReviewDialog";
import {
  closeAccessRequestReviewDialog,
  closeRequestAccessDialog,
} from "@/features/permissions/store/accessRequestsSlice";

export function AccessRequestDialogs() {
  const dispatch = useAppDispatch();
  const requestTarget = useAppSelector((state) => state.accessRequests.requestDialog);
  const reviewRequestId = useAppSelector((state) => state.accessRequests.reviewDialogRequestId);

  return (
    <>
      {requestTarget && (
        <RequestAccessDialog
          key={requestTarget.urn}
          target={requestTarget}
          onClose={() => dispatch(closeRequestAccessDialog())}
        />
      )}
      {reviewRequestId && (
        <AccessRequestReviewDialog
          key={reviewRequestId}
          requestId={reviewRequestId}
          onClose={() => dispatch(closeAccessRequestReviewDialog())}
        />
      )}
    </>
  );
}
