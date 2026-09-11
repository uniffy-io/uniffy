import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarCheck, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { AuthShell } from "@/features/auth/components/AuthShell";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import {
  confirmationFor,
  GENERIC_REFUSAL,
  INCOMPLETE_LINK,
  isUsableRespondLink,
  refusalFor,
  answerLabelFor,
} from "@/features/calendar/utils/respondFeedback";

const RESPOND_ENDPOINT = "/api/calendar/respond";

type Phase = "asking" | "sending" | "done" | "failed";

/**
 * The page an RSVP link in an invitation email opens.
 *
 * The link only carries the token; this page performs the POST. That is the
 * whole reason the page exists - a mail scanner that opens every URL in a
 * message must not be able to answer on the recipient's behalf. Signing in is
 * not required, because the token names the attendee and the ordinary access
 * path decides whether they may still answer.
 */
export function RespondToInvitationPage() {
  useDocumentTitle("Respond to invitation");
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const response = params.get("response") ?? "";

  const answerLabel = answerLabelFor(response);
  const usable = isUsableRespondLink(token, response);

  // Whether the link is usable is known from the URL at first render, so it is
  // an initial state rather than an effect that re-renders to correct itself.
  const [phase, setPhase] = useState<Phase>(usable ? "asking" : "failed");
  const [message, setMessage] = useState<string | null>(usable ? null : INCOMPLETE_LINK);

  const submit = async () => {
    setPhase("sending");
    try {
      const result = await fetch(RESPOND_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, response }),
      });
      if (result.ok) {
        setPhase("done");
        setMessage(confirmationFor(response));
        return;
      }
      setPhase("failed");
      setMessage(refusalFor(result.status));
    } catch {
      setPhase("failed");
      setMessage(GENERIC_REFUSAL);
    }
  };

  return (
    <AuthShell>
      <div className="space-y-4 text-center">
        {phase === "done" ? (
          <CheckCircle size={40} weight="duotone" className="mx-auto text-primary" />
        ) : phase === "failed" ? (
          <WarningCircle size={40} weight="duotone" className="mx-auto text-red-500" />
        ) : (
          <CalendarCheck size={40} weight="duotone" className="mx-auto text-primary" />
        )}

        <h1 className="text-lg font-medium">
          {phase === "done"
            ? "Answer recorded"
            : phase === "failed"
              ? "Not recorded"
              : `Answer "${answerLabel ?? ""}"?`}
        </h1>

        {message && <p className="text-sm text-muted-foreground">{message}</p>}

        {phase === "asking" && (
          <p className="text-sm text-muted-foreground">
            Confirm below and the organizer will see your answer.
          </p>
        )}

        {(phase === "asking" || phase === "sending") && usable && (
          <Button type="button" size="lg" onClick={submit} disabled={phase === "sending"}>
            {phase === "sending" ? "Sending..." : `Answer ${answerLabel}`}
          </Button>
        )}
      </div>
    </AuthShell>
  );
}
