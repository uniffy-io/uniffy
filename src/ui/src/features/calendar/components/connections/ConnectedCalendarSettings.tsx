import { useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Select, type SelectOption } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { updateConnectedCalendar } from "@/features/calendar/store/calendarConnectionsThunks";
import type {
  CalendarProviderId,
  CalendarSyncDirection,
  ProviderCalendarInfo,
} from "@/features/calendar/types/connections";
import { connectedStateCopy, needsAttention } from "@/features/calendar/utils/connectionCopy";
import { cn } from "@/shared/utils/cn";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";

const DIRECTION_OPTIONS: SelectOption<CalendarSyncDirection>[] = [
  { value: "two_way", label: "Two-way" },
  { value: "inbound", label: "Read-only" },
];

interface ConnectedCalendarSettingsProps {
  calendar: ProviderCalendarInfo;
  provider: CalendarProviderId | null;
  /** The account is paused or must reconnect; settings wait until it syncs again. */
  disabled: boolean;
}

/** One provider calendar of a connected account: whether it syncs, which way, and if it counts as busy. */
export function ConnectedCalendarSettings({
  calendar,
  provider,
  disabled,
}: ConnectedCalendarSettingsProps) {
  const dispatch = useAppDispatch();
  const [saving, setSaving] = useState(false);
  // Outlook reports no color for most calendars; the Uniffy copy always carries one.
  const linkedColor = useAppSelector((state) =>
    calendar.calendarId ? state.calendar.calendars[calendar.calendarId]?.color : undefined,
  );

  const save = async (patch: {
    syncEnabled?: boolean;
    direction?: CalendarSyncDirection;
    countsAsBusy?: boolean;
  }) => {
    setSaving(true);
    await dispatch(updateConnectedCalendar({ connectedCalendarId: calendar.id, ...patch }));
    setSaving(false);
  };

  const status = calendar.syncEnabled
    ? connectedStateCopy(calendar.state, calendar.lastError, provider)
    : null;
  const locked = disabled || saving;
  const readOnlyReason =
    "Two-way sync is off for this calendar: the account cannot change it, or your organization keeps connected calendars read-only.";

  return (
    <div
      className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start"
      data-testid="connected-calendar-settings"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <span
          className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: linkedColor || calendar.providerColor || undefined }}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="truncate text-sm text-foreground">
            {calendar.name}
            {calendar.isPrimary && (
              <span className="ml-2 text-xs text-subtle-foreground">Primary</span>
            )}
          </p>
          {status && (
            <p
              className={cn(
                "text-xs",
                needsAttention(calendar.state) || calendar.state === "failing"
                  ? "text-destructive"
                  : "text-subtle-foreground",
              )}
            >
              {status}
            </p>
          )}
          {calendar.syncEnabled && calendar.state === "healthy" && calendar.lastSuccessAt && (
            <p className="text-xs text-subtle-foreground">
              Synced {formatRelativeTime(calendar.lastSuccessAt)}
              {calendar.skippedCount > 0 && ` · ${calendar.skippedCount} entries skipped`}
            </p>
          )}
          {calendar.syncEnabled && !calendar.canWrite && (
            <p className="text-xs text-subtle-foreground" data-testid="connected-read-only-reason">
              {readOnlyReason}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-4 sm:pl-0">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Sync
          <ToggleSwitch
            enabled={calendar.syncEnabled}
            onChange={(syncEnabled) => void save({ syncEnabled })}
            disabled={locked}
            size="sm"
            ariaLabel={`Sync ${calendar.name}`}
          />
        </label>
        {calendar.syncEnabled && (
          <>
            <Select
              value={calendar.canWrite ? calendar.direction : "inbound"}
              onChange={(direction) => void save({ direction })}
              options={DIRECTION_OPTIONS}
              disabled={locked || !calendar.canWrite}
              size="sm"
              triggerClassName="w-32"
              ariaLabel={`Sync direction for ${calendar.name}`}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Count as busy
              <ToggleSwitch
                enabled={calendar.countsAsBusy}
                onChange={(countsAsBusy) => void save({ countsAsBusy })}
                disabled={locked}
                size="sm"
                ariaLabel={`Count ${calendar.name} as busy`}
              />
            </label>
          </>
        )}
      </div>
    </div>
  );
}
