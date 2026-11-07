import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PlugsConnected, WarningCircle } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/features/auth/components/AuthShell";
import { completeCalendarConnection } from "@/features/calendar/store/calendarConnectionsThunks";
import {
  CALENDAR_HOME,
  INCOMPLETE_CALLBACK,
  callbackDestination,
  callbackFailureMessage,
  callbackRequest,
  completeOnce,
} from "@/features/calendar/utils/connectCallback";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";

/** Where Google and Microsoft send the member back after signing in to connect a calendar. */
export function ConnectCallbackPage() {
  useDocumentTitle("Connecting calendar");
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const [request] = useState(() => callbackRequest(params));
  const [failure, setFailure] = useState<string | null>(request ? null : INCOMPLETE_CALLBACK);

  useEffect(() => {
    if (!request || !organizationId) return;
    let active = true;
    void completeOnce(dispatch, request).then((outcome) => {
      if (!active) return;
      if (completeCalendarConnection.fulfilled.match(outcome)) {
        const { connection, returnPath } = outcome.payload;
        navigate(callbackDestination(returnPath, connection.id), { replace: true });
        return;
      }
      setFailure(callbackFailureMessage(outcome.payload));
    });
    return () => {
      active = false;
    };
  }, [dispatch, navigate, organizationId, request]);

  return (
    <AuthShell>
      <div className="space-y-4 text-center" data-testid="connect-callback">
        {failure ? (
          <WarningCircle size={40} weight="duotone" className="mx-auto text-destructive" />
        ) : (
          <PlugsConnected size={40} weight="duotone" className="mx-auto text-primary" />
        )}
        <h1 className="text-lg font-medium">
          {failure ? "Calendar not connected" : "Connecting your calendar..."}
        </h1>
        {failure ? (
          <>
            <p className="text-sm text-muted-foreground" role="alert">
              {failure}
            </p>
            <Button type="button" onClick={() => navigate(CALENDAR_HOME, { replace: true })}>
              Back to calendar
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Finishing the sign-in. This takes a moment.
          </p>
        )}
      </div>
    </AuthShell>
  );
}
