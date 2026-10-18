import { useEffect, useState } from "react";
import { ArrowsClockwise, Check, Copy, Link, Prohibit } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAppDispatch } from "@/app/hooks";
import {
  fetchCalendarFeed,
  regenerateCalendarFeed,
  revokeCalendarFeed,
} from "@/features/calendar/store/calendarThunks";
import type { CalendarFeed } from "@/features/calendar/types/interop";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";

const COPIED_FEEDBACK_MS = 2000;

/**
 * The subscribe link for this calendar: show it, replace it, or stop it.
 *
 * The link is read-only and scoped to one person's view, so it is safe to paste
 * into Outlook, Google or Apple - but it is also a credential, which is why
 * replacing it says plainly that existing subscriptions stop working.
 */
interface CalendarFeedPanelProps {
  /** Omitted for the member's default calendar. */
  calendarId?: string;
}

export function CalendarFeedPanel({ calendarId }: CalendarFeedPanelProps) {
  const dispatch = useAppDispatch();

  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<"regenerate" | "revoke" | null>(null);

  useEffect(() => {
    let cancelled = false;
    void dispatch(fetchCalendarFeed(calendarId)).then((outcome) => {
      if (cancelled) return;
      if (fetchCalendarFeed.fulfilled.match(outcome)) setFeed(outcome.payload);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [dispatch, calendarId]);

  const handleCopy = () => {
    if (!feed?.url) return;
    navigator.clipboard.writeText(feed.url);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  };

  const handleRegenerate = async () => {
    setConfirming(null);
    setBusy(true);
    const outcome = await dispatch(regenerateCalendarFeed(calendarId));
    setBusy(false);
    if (regenerateCalendarFeed.fulfilled.match(outcome)) setFeed(outcome.payload);
  };

  const handleRevoke = async () => {
    setConfirming(null);
    setBusy(true);
    const outcome = await dispatch(revokeCalendarFeed(calendarId));
    setBusy(false);
    if (revokeCalendarFeed.fulfilled.match(outcome)) setFeed(null);
  };

  if (loading) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-subtle-foreground">
        Paste this link into Outlook, Google Calendar or Apple Calendar to see your events there. It
        is read-only, and only shows what you can already see.
      </p>

      {feed?.url ? (
        <>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 truncate rounded-md bg-input px-3 py-2 text-xs"
              title={feed.url}
            >
              {feed.url}
            </code>
            <Button type="button" variant="outline" onClick={handleCopy} aria-label="Copy link">
              {copied ? <Check size={16} weight="bold" /> : <Copy size={16} weight="duotone" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <p className="text-xs text-subtle-foreground">
            {feed.lastUsedAt
              ? `Last checked ${formatRelativeTime(feed.lastUsedAt)}.`
              : "No calendar has checked this link yet."}
          </p>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirming("regenerate")}
            >
              <ArrowsClockwise size={16} weight="duotone" />
              Replace link
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirming("revoke")}
            >
              <Prohibit size={16} weight="duotone" />
              Stop sharing
            </Button>
          </div>
        </>
      ) : (
        <Button type="button" variant="outline" disabled={busy} onClick={handleRegenerate}>
          <Link size={16} weight="duotone" />
          Create a subscribe link
        </Button>
      )}

      <ConfirmDialog
        isOpen={confirming === "regenerate"}
        onClose={() => setConfirming(null)}
        onConfirm={handleRegenerate}
        title="Replace this link?"
        message="Any calendar already subscribed with the current link will stop updating. You will need to paste the new link into each of them."
        confirmLabel="Replace link"
        variant="warning"
        loading={busy}
      />
      <ConfirmDialog
        isOpen={confirming === "revoke"}
        onClose={() => setConfirming(null)}
        onConfirm={handleRevoke}
        title="Stop sharing this calendar?"
        message="Every calendar subscribed with this link stops updating immediately."
        confirmLabel="Stop sharing"
        variant="danger"
        loading={busy}
      />
    </div>
  );
}
