import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useSettings, useNotificationSettings } from "@/features/settings/hooks/useSettings";
import {
  DEFAULT_QUIET_HOURS_END,
  DEFAULT_QUIET_HOURS_START,
  clockTimeToDecimalHours,
  decimalHoursToClockTime,
  quietHoursToggleUpdate,
  quietHoursValidationError,
} from "@/features/settings/utils/quietHours";
import { usePushSubscription } from "@/features/notifications/hooks/usePushSubscription";
import { ReminderSelector } from "@/features/calendar/components/modals/ReminderSelector";
import { TimeSelect } from "@/features/calendar/components/modals/TimeSelect";

const NOTIFICATION_TYPE_ROWS = [
  { type: "CONTENT_SHARED", label: "Content Shared" },
  { type: "CONTENT_MENTIONED", label: "Content Mentioned" },
  { type: "CONTENT_EDITED", label: "Content Edited" },
  { type: "CALENDAR_REMINDER", label: "Calendar Reminder" },
  { type: "CALENDAR_INVITE", label: "Calendar Invite" },
  { type: "CALENDAR_RESPONSE", label: "Calendar Response" },
  { type: "PERMISSION_GRANTED", label: "Permission Granted" },
  { type: "PERMISSION_REVOKED", label: "Permission Revoked" },
  { type: "ACCESS_REQUESTED", label: "Access Requested" },
  { type: "ACCESS_REQUEST_DENIED", label: "Access Request Denied" },
  { type: "SYSTEM_ANNOUNCEMENT", label: "System Announcement" },
] as const;

const DEFAULT_CHANNELS: Record<string, Record<string, boolean>> = {
  CONTENT_SHARED: { in_app: true, browser: true, email: true },
  CONTENT_MENTIONED: { in_app: true, browser: true, email: true },
  CONTENT_EDITED: { in_app: true, browser: false, email: false },
  CALENDAR_REMINDER: { in_app: true, browser: true, email: false },
  CALENDAR_INVITE: { in_app: true, browser: true, email: true },
  CALENDAR_RESPONSE: { in_app: true, browser: false, email: false },
  PERMISSION_GRANTED: { in_app: true, browser: false, email: true },
  PERMISSION_REVOKED: { in_app: true, browser: false, email: true },
  ACCESS_REQUESTED: { in_app: true, browser: true, email: true },
  ACCESS_REQUEST_DENIED: { in_app: true, browser: true, email: false },
  SYSTEM_ANNOUNCEMENT: { in_app: true, browser: true, email: true },
};

const CHANNEL_LABELS: Record<string, string> = {
  in_app: "in-app",
  browser: "browser",
  email: "email",
};

export function NotificationsSection() {
  const { updateSettings, saving } = useSettings();
  const notifications = useNotificationSettings();
  const { subscribe, unsubscribe, permissionState, isSupported } = usePushSubscription();

  const [quietHoursDraft, setQuietHoursDraft] = useState<{ start: string; end: string } | null>(
    null,
  );
  const [quietHoursError, setQuietHoursError] = useState<string | null>(null);

  const quietHoursEnabled = Boolean(notifications.quietHoursStart && notifications.quietHoursEnd);
  const quietHoursStart = quietHoursDraft?.start ?? notifications.quietHoursStart ?? "";
  const quietHoursEnd = quietHoursDraft?.end ?? notifications.quietHoursEnd ?? "";

  const handleQuietHoursToggle = (enabled: boolean) => {
    setQuietHoursDraft(null);
    setQuietHoursError(null);
    updateSettings({ notifications: quietHoursToggleUpdate(enabled) });
  };

  const handleQuietHoursTimeChange = (field: "start" | "end", value: string) => {
    const start = field === "start" ? value : quietHoursStart;
    const end = field === "end" ? value : quietHoursEnd;
    const error = quietHoursValidationError(start, end);
    if (error) {
      setQuietHoursDraft({ start, end });
      setQuietHoursError(error);
      return;
    }
    setQuietHoursDraft(null);
    setQuietHoursError(null);
    updateSettings({ notifications: { quietHoursStart: start, quietHoursEnd: end } });
  };

  const handleToggle = async (field: string, value: boolean) => {
    // Browser channel needs a live push subscription; persist only after subscribe() succeeds.
    if (field === "browserEnabled") {
      if (value) {
        const result = await subscribe();
        if (!result.success) {
          return;
        }
      } else {
        await unsubscribe();
      }
    }
    updateSettings({
      notifications: { [field]: value },
    });
  };

  const handleFrequencyChange = (frequency: string) => {
    updateSettings({
      notifications: { emailFrequency: frequency },
    });
  };

  const handleChannelToggle = (notifType: string, channel: string, enabled: boolean) => {
    const existing = notifications.channelOverrides ?? {};
    const typeOverrides = existing[notifType] ?? {};

    updateSettings({
      notifications: {
        channelOverrides: {
          ...existing,
          [notifType]: {
            ...typeOverrides,
            [channel]: enabled,
          },
        },
      },
    });
  };

  const handleResetChannels = () => {
    updateSettings({
      notifications: { channelOverrides: {} },
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Notifications</h1>
        <p className="text-muted-foreground">Configure how and when you receive notifications.</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Real-time Alerts</h2>

        <div className="space-y-4 bg-card rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-foreground">Show Toast Notifications</div>
              <div className="text-sm text-muted-foreground">
                Display pop-up alerts when new notifications arrive while you are using Uniffy.
                Toasts are suppressed during Zen Mode or when the notification panel is open.
              </div>
            </div>
            <ToggleSwitch
              enabled={notifications.toastEnabled}
              onChange={(v) => handleToggle("toastEnabled", v)}
              disabled={saving}
            />
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-border">
            <div>
              <div className="font-medium text-foreground">Play Notification Sounds</div>
              <div className="text-sm text-muted-foreground">
                Play a short chime when a notification arrives. Sounds pause while your status is Do
                Not Disturb and during quiet hours.
              </div>
            </div>
            <ToggleSwitch
              enabled={notifications.soundEnabled}
              onChange={(v) => handleToggle("soundEnabled", v)}
              disabled={saving}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Browser Notifications</h2>

        <div className="space-y-4 bg-card rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-foreground">Enable Browser Notifications</div>
              <div className="text-sm text-muted-foreground">
                Show push notifications in your browser
              </div>
              {isSupported && permissionState === "denied" && (
                <div className="text-xs mt-1" style={{ color: "var(--status-error)" }}>
                  Notifications are blocked by your browser. Re-enable in browser site settings.
                </div>
              )}
              {isSupported && permissionState === "granted" && notifications.browserEnabled && (
                <div className="text-xs mt-1" style={{ color: "var(--status-success)" }}>
                  Permission granted
                </div>
              )}
              {!isSupported && (
                <div className="text-xs text-muted-foreground mt-1">
                  Push notifications are not supported in this browser.
                </div>
              )}
            </div>
            <ToggleSwitch
              enabled={notifications.browserEnabled}
              onChange={(v) => handleToggle("browserEnabled", v)}
              disabled={saving || !isSupported || permissionState === "denied"}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Quiet Hours</h2>
        <p className="text-sm text-muted-foreground">
          Pause browser push and notification sounds during a daily window. In-app notifications
          still arrive. Times follow your profile timezone (UTC when unset).
        </p>

        <div className="space-y-4 bg-card rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-foreground">Enable Quiet Hours</div>
              <div className="text-sm text-muted-foreground">
                An end time earlier than the start spans midnight, like 22:00 to 08:00.
              </div>
            </div>
            <ToggleSwitch
              enabled={quietHoursEnabled}
              onChange={handleQuietHoursToggle}
              disabled={saving}
            />
          </div>

          {quietHoursEnabled && (
            <div className="pt-4 border-t border-border space-y-3">
              <div className="flex flex-wrap items-end gap-6">
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-foreground">Start</span>
                  <TimeSelect
                    value={clockTimeToDecimalHours(quietHoursStart || DEFAULT_QUIET_HOURS_START)}
                    disabled={saving}
                    ariaLabel="Quiet hours start time"
                    onChange={(v) =>
                      handleQuietHoursTimeChange("start", decimalHoursToClockTime(v))
                    }
                    className="w-36"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-foreground">End</span>
                  <TimeSelect
                    value={clockTimeToDecimalHours(quietHoursEnd || DEFAULT_QUIET_HOURS_END)}
                    disabled={saving}
                    ariaLabel="Quiet hours end time"
                    onChange={(v) => handleQuietHoursTimeChange("end", decimalHoursToClockTime(v))}
                    className="w-36"
                  />
                </div>
              </div>
              {quietHoursError && (
                <div className="text-xs" role="alert" style={{ color: "var(--status-error)" }}>
                  {quietHoursError}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Email Notifications</h2>

        <div className="space-y-4 bg-card rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-foreground">Enable Email Notifications</div>
              <div className="text-sm text-muted-foreground">
                Receive important updates via email
              </div>
            </div>
            <ToggleSwitch
              enabled={notifications.emailEnabled}
              onChange={(v) => handleToggle("emailEnabled", v)}
              disabled={saving}
            />
          </div>

          {notifications.emailEnabled && (
            <div className="pt-4 border-t border-border">
              <div className="font-medium text-foreground mb-3">Email Frequency</div>
              <div className="space-y-2">
                {[
                  {
                    id: "instant",
                    label: "Instant",
                    description: "Get notified immediately",
                  },
                  {
                    id: "hourly",
                    label: "Hourly Digest",
                    description: "Summary every hour",
                  },
                  {
                    id: "daily",
                    label: "Daily Digest",
                    description: "Summary once a day",
                  },
                ].map(({ id, label, description }) => (
                  <button
                    key={id}
                    type="button"
                    disabled={saving}
                    className={`flex items-center w-full p-3 rounded-lg border transition-colors ${
                      notifications.emailFrequency === id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                    onClick={() => handleFrequencyChange(id)}
                  >
                    <div className="text-left">
                      <div className="font-medium text-foreground">{label}</div>
                      <div className="text-sm text-muted-foreground">{description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Per-type channel matrix: master toggles above (browser/email) cascade down and disable cells. */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Notification Types</h2>
        <p className="text-sm text-muted-foreground">
          Control which channels are used for each notification type. Disabled master switches above
          override per-type settings.
        </p>

        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="grid grid-cols-[1fr_4rem_4rem_4rem] gap-0 px-4 py-2.5 border-b border-border bg-muted/30">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Type
            </div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">
              App
            </div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">
              Browser
            </div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">
              Email
            </div>
          </div>

          {NOTIFICATION_TYPE_ROWS.map(({ type, label }) => {
            const channels = notifications.channelOverrides?.[type] ?? {};
            const defaults = DEFAULT_CHANNELS[type] ?? {
              in_app: true,
              browser: true,
              email: true,
            };

            return (
              <div
                key={type}
                className="grid grid-cols-[1fr_4rem_4rem_4rem] gap-0 px-4 py-2.5 border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors"
              >
                <div className="text-sm text-foreground">{label}</div>
                {(["in_app", "browser", "email"] as const).map((channel) => {
                  const isEnabled = channels[channel] ?? defaults[channel] ?? true;
                  const isMasterDisabled =
                    (channel === "browser" && !notifications.browserEnabled) ||
                    (channel === "email" && !notifications.emailEnabled);

                  return (
                    <div key={channel} className="flex justify-center">
                      <Checkbox
                        checked={isEnabled}
                        disabled={saving || isMasterDisabled}
                        aria-label={`${label} ${CHANNEL_LABELS[channel]} notifications`}
                        onChange={(e) => handleChannelToggle(type, channel, e.target.checked)}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <Button variant="ghost" size="xs" disabled={saving} onClick={handleResetChannels}>
          Reset to defaults
        </Button>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Default Reminders</h2>
        <p className="text-sm text-muted-foreground">
          Set the default reminder intervals for new calendar events.
        </p>
        <div className="bg-card rounded-lg border border-border p-4">
          <ReminderSelector
            value={notifications.defaultReminderIntervals ?? [15]}
            onChange={(reminders) => {
              updateSettings({
                notifications: { defaultReminderIntervals: reminders },
              });
            }}
          />
        </div>
      </section>
    </div>
  );
}
