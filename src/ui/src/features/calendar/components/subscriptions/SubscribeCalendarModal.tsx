import { useId, useState } from "react";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { CalendarColorPicker } from "@/features/calendar/components/calendars/CalendarColorPicker";
import {
  DEFAULT_REFRESH_INTERVAL,
  REFRESH_INTERVAL_OPTIONS,
  SUBSCRIBED_CALENDAR_COLOR,
} from "@/features/calendar/constants";
import {
  createCalendarSubscription,
  updateCalendarSubscription,
  updateCalendarThunk,
} from "@/features/calendar/store";
import type { FeedCheckError } from "@/features/calendar/store/calendarsThunks";
import type { CalendarInfo } from "@/features/calendar/types";
import { feedErrorCopy } from "@/features/calendar/utils/subscriptionCopy";

interface SubscribeCalendarModalProps {
  /** The subscribed calendar being edited; omitted to subscribe to a new one. */
  calendar?: CalendarInfo;
  onClose: () => void;
}

/** Follow an external iCalendar address; editing shows only its host, since the server never returns it. */
export function SubscribeCalendarModal({ calendar, onClose }: SubscribeCalendarModalProps) {
  const dispatch = useAppDispatch();
  const subscription = calendar?.subscription;
  const isEditing = !!calendar;
  const [url, setUrl] = useState("");
  const [replacingUrl, setReplacingUrl] = useState(!isEditing);
  const [name, setName] = useState(calendar?.name ?? "");
  const [color, setColor] = useState(calendar?.color ?? SUBSCRIBED_CALENDAR_COLOR);
  const [interval, setRefreshInterval] = useState(
    subscription?.refreshIntervalMinutes ?? DEFAULT_REFRESH_INTERVAL,
  );
  const [countsAsBusy, setCountsAsBusy] = useState(subscription?.countsAsBusy ?? false);
  const [submitting, setSubmitting] = useState(false);
  // The server read the address and refused it; shown here, nothing was saved.
  const [checkError, setCheckError] = useState<FeedCheckError | null>(null);
  const fieldId = useId();

  const urlReady = !replacingUrl || url.trim().length > 0;
  const canSubmit = urlReady && !submitting && (!isEditing || name.trim().length > 0);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setCheckError(null);
    let ok: boolean;
    let refused: FeedCheckError | undefined;
    if (!calendar) {
      const outcome = await dispatch(
        createCalendarSubscription({
          url: url.trim(),
          name: name.trim(),
          color,
          refreshIntervalMinutes: interval,
          countsAsBusy,
        }),
      );
      ok = createCalendarSubscription.fulfilled.match(outcome);
      if (createCalendarSubscription.fulfilled.match(outcome)) refused = outcome.payload.checkError;
    } else {
      ok = true;
      if (name.trim() !== calendar.name || color !== calendar.color) {
        const renamed = await dispatch(
          updateCalendarThunk({ calendarId: calendar.id, name: name.trim(), color }),
        );
        ok = updateCalendarThunk.fulfilled.match(renamed);
      }
      const changed =
        (replacingUrl && url.trim().length > 0) ||
        interval !== subscription?.refreshIntervalMinutes ||
        countsAsBusy !== subscription?.countsAsBusy;
      if (ok && changed) {
        const outcome = await dispatch(
          updateCalendarSubscription({
            calendarId: calendar.id,
            url: replacingUrl ? url.trim() : undefined,
            refreshIntervalMinutes: interval,
            countsAsBusy,
          }),
        );
        ok = updateCalendarSubscription.fulfilled.match(outcome);
        if (updateCalendarSubscription.fulfilled.match(outcome)) {
          refused = outcome.payload.checkError;
        }
      }
    }
    setSubmitting(false);
    if (refused) {
      setCheckError(refused);
      return;
    }
    if (ok) onClose();
  };

  return (
    <Modal onClose={onClose} closeDisabled={submitting} maxWidth="max-w-md">
      <form onSubmit={handleSubmit}>
        <ModalHeader
          title={isEditing ? "Edit subscription" : "Subscribe to a calendar"}
          description={
            isEditing
              ? undefined
              : "Follow a Google, Outlook or any other iCalendar link. Its events are read-only here."
          }
        />

        <ModalBody>
          <div>
            <label htmlFor={`${fieldId}-url`} className="block text-sm text-muted-foreground mb-1">
              Calendar address
            </label>
            {replacingUrl ? (
              <>
                <Input
                  id={`${fieldId}-url`}
                  type="url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setCheckError(null);
                  }}
                  placeholder="webcal:// or https://"
                  aria-invalid={checkError ? true : undefined}
                  aria-describedby={checkError ? `${fieldId}-url-error` : undefined}
                  maxLength={2000}
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  data-testid="subscription-url"
                />
                {checkError && (
                  <p
                    id={`${fieldId}-url-error`}
                    role="alert"
                    className="mt-1 text-xs text-destructive"
                    data-testid="subscription-check-error"
                  >
                    {feedErrorCopy(checkError.error, checkError.status)}
                  </p>
                )}
                <p className="mt-1 text-xs text-subtle-foreground">
                  Treat a private link like a password: anyone who has it can read the calendar.
                  Uniffy stores it encrypted and never shows it again.
                </p>
              </>
            ) : (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-foreground">{subscription?.urlHost}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setReplacingUrl(true)}
                >
                  Replace address
                </Button>
              </div>
            )}
          </div>

          <div>
            <label htmlFor={`${fieldId}-name`} className="block text-sm text-muted-foreground mb-1">
              Name {!isEditing && <span className="text-subtle-foreground">(optional)</span>}
            </label>
            <Input
              id={`${fieldId}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Public holidays"
              maxLength={200}
            />
          </div>

          <CalendarColorPicker value={color} onChange={setColor} />

          <div>
            <span className="block text-sm text-muted-foreground mb-1">Refresh</span>
            <Select
              value={interval}
              onChange={setRefreshInterval}
              options={REFRESH_INTERVAL_OPTIONS}
              ariaLabel="Refresh interval"
            />
          </div>

          <Checkbox
            checked={countsAsBusy}
            onChange={(e) => setCountsAsBusy(e.target.checked)}
            label="Count these events as busy"
            description="Colleagues scheduling with you see these times as taken."
          />
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting} disabled={!canSubmit}>
            {submitting && replacingUrl ? "Checking..." : isEditing ? "Save changes" : "Subscribe"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
