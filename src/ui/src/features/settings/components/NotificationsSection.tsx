import { Fragment, useState } from "react";
import { BellSimple, EnvelopeSimple, Globe, LockSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  NOTIFICATION_PREFERENCE_GROUPS,
  type NotificationDeliveryChannel,
} from "@/features/settings/config/notificationPreferences";

const CHANNEL_LABELS: Record<string, string> = {
  in_app: "in-app",
  browser: "browser",
  email: "email",
};

const CHANNEL_COLUMNS: {
  channel: NotificationDeliveryChannel;
  label: string;
  icon: typeof BellSimple;
}[] = [
  { channel: "in_app", label: "App", icon: BellSimple },
  { channel: "browser", label: "Browser", icon: Globe },
  { channel: "email", label: "Email", icon: EnvelopeSimple },
];

const DEFAULT_EMAIL_DIGEST_TIME = "08:00";

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

  const handleDigestTimeChange = (value: number) => {
    updateSettings({
      notifications: { emailDigestTime: decimalHoursToClockTime(value) },
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

      <div className="space-y-8">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Real-time Alerts</h2>

          <div className="space-y-4 bg-card rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-6">
              <div>
                <div className="font-medium text-foreground">Show Toast Notifications</div>
                <div className="text-sm font-medium text-muted-foreground">
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

            <div className="flex items-center justify-between gap-6 pt-4 border-t border-border">
              <div>
                <div className="font-medium text-foreground">Play Notification Sounds</div>
                <div className="text-sm font-medium text-muted-foreground">
                  Play a short chime when a notification arrives. Sounds pause while your status is
                  Do Not Disturb and during quiet hours.
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
            <div className="flex items-center justify-between gap-6">
              <div>
                <div className="font-medium text-foreground">Enable Browser Notifications</div>
                <div className="text-sm font-medium text-muted-foreground">
                  Show push notifications in your browser
                </div>
                {isSupported && permissionState === "denied" && (
                  <div
                    className="text-xs font-medium mt-1"
                    style={{ color: "var(--status-error)" }}
                  >
                    Notifications are blocked by your browser. Re-enable in browser site settings.
                  </div>
                )}
                {isSupported && permissionState === "granted" && notifications.browserEnabled && (
                  <div
                    className="text-xs font-medium mt-1"
                    style={{ color: "var(--status-success)" }}
                  >
                    Permission granted
                  </div>
                )}
                {!isSupported && (
                  <div className="text-xs font-medium text-muted-foreground mt-1">
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
          <p className="text-sm font-medium text-muted-foreground">
            Pause browser push, notification sounds, and notification emails during a daily window.
            In-app notifications still arrive. Times follow your profile timezone (UTC when unset).
          </p>

          <div className="space-y-4 bg-card rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-6">
              <div>
                <div className="font-medium text-foreground">Enable Quiet Hours</div>
                <div className="text-sm font-medium text-muted-foreground">
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
                      onChange={(v) =>
                        handleQuietHoursTimeChange("end", decimalHoursToClockTime(v))
                      }
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
            <div className="flex items-center justify-between gap-6">
              <div>
                <div className="font-medium text-foreground">Enable Email Notifications</div>
                <div className="text-sm font-medium text-muted-foreground">
                  Receive important updates via email. Required support-access security messages are
                  always sent.
                </div>
              </div>
              <ToggleSwitch
                enabled={notifications.emailEnabled}
                onChange={(v) => handleToggle("emailEnabled", v)}
                disabled={saving}
              />
            </div>

            {notifications.emailEnabled && (
              <div className="pt-4 border-t border-border space-y-4">
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
                        <div className="text-sm font-medium text-muted-foreground">
                          {description}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                {notifications.emailFrequency === "daily" && (
                  <div className="pt-4 border-t border-border flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-foreground">Daily delivery time</div>
                      <div className="text-sm font-medium text-muted-foreground">
                        Uses your profile timezone, or UTC when no timezone is set.
                      </div>
                    </div>
                    <TimeSelect
                      value={clockTimeToDecimalHours(
                        notifications.emailDigestTime || DEFAULT_EMAIL_DIGEST_TIME,
                      )}
                      disabled={saving}
                      ariaLabel="Daily email digest time"
                      onChange={handleDigestTimeChange}
                      className="w-36"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Notification Types</h2>
          <p className="text-sm font-medium text-muted-foreground">
            Control which channels are used for each notification type. Disabled master switches
            above override per-type settings.
          </p>

          <Table>
            <TableHeader>
              <TableRow hoverable={false}>
                <TableHead>Type</TableHead>
                {CHANNEL_COLUMNS.map(({ channel, label, icon: ChannelIcon }) => (
                  <TableHead key={channel} align="center" className="w-28">
                    <div className="flex items-center justify-center gap-1.5">
                      <ChannelIcon size={14} weight="bold" className="shrink-0" />
                      <span className="hidden sm:inline">{label}</span>
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {NOTIFICATION_PREFERENCE_GROUPS.map((group) => (
                <Fragment key={group.label}>
                  <TableRow hoverable={false}>
                    <TableCell
                      colSpan={4}
                      className="bg-muted/30 py-2 md:py-2 lg:py-2 text-sm font-semibold text-foreground"
                    >
                      {group.label}
                    </TableCell>
                  </TableRow>
                  {group.rows.map(({ type, label, defaults, emailManaged }) => {
                    const channels = notifications.channelOverrides?.[type] ?? {};

                    return (
                      <TableRow key={type}>
                        <TableCell>
                          <div className="text-sm text-foreground">{label}</div>
                        </TableCell>
                        {CHANNEL_COLUMNS.map(({ channel }) => {
                          const isManagedEmail = channel === "email" && emailManaged;
                          const isMasterDisabled =
                            (channel === "browser" && !notifications.browserEnabled) ||
                            (channel === "email" && !notifications.emailEnabled);

                          return (
                            <TableCell key={channel} align="center">
                              <div className="flex justify-center">
                                {isManagedEmail ? (
                                  <span
                                    tabIndex={0}
                                    aria-label={`${label} security email is always sent`}
                                    className="group/lock relative flex h-5 w-5 items-center justify-center text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                                  >
                                    <LockSimple size={16} weight="fill" />
                                    <span className="pointer-events-none absolute right-full top-1/2 z-10 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground shadow-md opacity-0 transition-opacity group-hover/lock:opacity-100 group-focus-visible/lock:opacity-100">
                                      Security emails are always sent
                                    </span>
                                  </span>
                                ) : (
                                  <Checkbox
                                    checked={channels[channel] ?? defaults[channel]}
                                    disabled={saving || isMasterDisabled}
                                    aria-label={`${label} ${CHANNEL_LABELS[channel]} notifications`}
                                    onChange={(e) =>
                                      handleChannelToggle(type, channel, e.target.checked)
                                    }
                                  />
                                )}
                              </div>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>

          <Button variant="ghost" size="xs" disabled={saving} onClick={handleResetChannels}>
            Reset to defaults
          </Button>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Default Reminders</h2>
          <p className="text-sm font-medium text-muted-foreground">
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
    </div>
  );
}
