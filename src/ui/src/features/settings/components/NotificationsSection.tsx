/**
 * Notifications settings section.
 */

import { cn } from '@/shared/utils/cn';
import { Button } from '@/components/ui/button';
import { useSettings, useNotificationSettings } from '@/features/settings/hooks/useSettings';
import { usePushSubscription } from '@/features/notifications/hooks/usePushSubscription';
import { ReminderSelector } from '@/features/calendar/components/modals/ReminderSelector';

const NOTIFICATION_TYPE_ROWS = [
    { type: 'CONTENT_SHARED', label: 'Content Shared' },
    { type: 'CONTENT_MENTIONED', label: 'Content Mentioned' },
    { type: 'CONTENT_EDITED', label: 'Content Edited' },
    { type: 'CALENDAR_REMINDER', label: 'Calendar Reminder' },
    { type: 'CALENDAR_INVITE', label: 'Calendar Invite' },
    { type: 'CALENDAR_RESPONSE', label: 'Calendar Response' },
    { type: 'PERMISSION_GRANTED', label: 'Permission Granted' },
    { type: 'PERMISSION_REVOKED', label: 'Permission Revoked' },
    { type: 'SYSTEM_ANNOUNCEMENT', label: 'System Announcement' },
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
    SYSTEM_ANNOUNCEMENT: { in_app: true, browser: true, email: true },
};

interface ChannelCheckboxProps {
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
}

function ChannelCheckbox({ checked, disabled, onChange }: ChannelCheckboxProps) {
    return (
        <button
            type="button"
            disabled={disabled}
            className={cn(
                'w-5 h-5 rounded border-2 transition-colors flex items-center justify-center',
                checked && !disabled ? 'bg-primary border-primary' : 'border-border',
                disabled && 'opacity-40 cursor-not-allowed',
                !disabled && 'cursor-pointer hover:border-primary/60'
            )}
            onClick={() => !disabled && onChange(!checked)}
        >
            {checked && (
                <svg className="w-3 h-3 text-primary-foreground" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            )}
        </button>
    );
}

interface ToggleSwitchProps {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    disabled?: boolean;
}

function ToggleSwitch({ enabled, onChange, disabled }: ToggleSwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={disabled}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                enabled ? 'bg-primary' : 'bg-muted'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={() => !disabled && onChange(!enabled)}
        >
            <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
            />
        </button>
    );
}

export function NotificationsSection() {
    const { updateSettings, saving } = useSettings();
    const notifications = useNotificationSettings();
    const { subscribe, unsubscribe, permissionState, isSupported } = usePushSubscription();

    const handleToggle = async (field: string, value: boolean) => {
        // When toggling desktop notifications, manage push subscription
        if (field === 'browserEnabled') {
            if (value) {
                const result = await subscribe();
                if (!result.success) {
                    // Don't persist the setting if subscription failed
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
                <p className="text-muted-foreground">
                    Configure how and when you receive notifications.
                </p>
            </div>

            {/* Browser Notifications */}
            <section className="space-y-4">
                <h2 className="text-lg font-semibold text-foreground">Browser Notifications</h2>

                <div className="space-y-4 bg-card rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="font-medium text-foreground">Enable Browser Notifications</div>
                            <div className="text-sm text-muted-foreground">
                                Show push notifications in your browser
                            </div>
                            {isSupported && permissionState === 'denied' && (
                                <div className="text-xs mt-1" style={{ color: 'var(--status-error)' }}>
                                    Notifications are blocked by your browser. Re-enable in browser site settings.
                                </div>
                            )}
                            {isSupported && permissionState === 'granted' && notifications.browserEnabled && (
                                <div className="text-xs mt-1" style={{ color: 'var(--status-success)' }}>
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
                            onChange={(v) => handleToggle('browserEnabled', v)}
                            disabled={saving || (!isSupported) || permissionState === 'denied'}
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <div className="font-medium text-foreground">Sound</div>
                            <div className="text-sm text-muted-foreground">
                                Play a sound when notifications arrive
                            </div>
                        </div>
                        <ToggleSwitch
                            enabled={notifications.soundEnabled}
                            onChange={(v) => handleToggle('soundEnabled', v)}
                            disabled={saving}
                        />
                    </div>
                </div>
            </section>

            {/* Email Notifications */}
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
                            onChange={(v) => handleToggle('emailEnabled', v)}
                            disabled={saving}
                        />
                    </div>

                    {notifications.emailEnabled && (
                        <div className="pt-4 border-t border-border">
                            <div className="font-medium text-foreground mb-3">Email Frequency</div>
                            <div className="space-y-2">
                                {[
                                    { id: 'instant', label: 'Instant', description: 'Get notified immediately' },
                                    { id: 'hourly', label: 'Hourly Digest', description: 'Summary every hour' },
                                    { id: 'daily', label: 'Daily Digest', description: 'Summary once a day' },
                                ].map(({ id, label, description }) => (
                                    <button
                                        key={id}
                                        type="button"
                                        disabled={saving}
                                        className={`flex items-center w-full p-3 rounded-lg border transition-colors ${
                                            notifications.emailFrequency === id
                                                ? 'border-primary bg-primary/5'
                                                : 'border-border hover:border-primary/50'
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

            {/* Channel Preferences */}
            <section className="space-y-4">
                <h2 className="text-lg font-semibold text-foreground">Notification Types</h2>
                <p className="text-sm text-muted-foreground">
                    Control which channels are used for each notification type.
                    Disabled master switches above override per-type settings.
                </p>

                <div className="bg-card rounded-lg border border-border overflow-hidden">
                    {/* Header row */}
                    <div className="grid grid-cols-[1fr_4rem_4rem_4rem] gap-0 px-4 py-2.5 border-b border-border bg-muted/30">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</div>
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">App</div>
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">Browser</div>
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">Email</div>
                    </div>

                    {/* Channel rows */}
                    {NOTIFICATION_TYPE_ROWS.map(({ type, label }) => {
                        const channels = notifications.channelOverrides?.[type] ?? {};
                        const defaults = DEFAULT_CHANNELS[type] ?? { in_app: true, browser: true, email: true };

                        return (
                            <div
                                key={type}
                                className="grid grid-cols-[1fr_4rem_4rem_4rem] gap-0 px-4 py-2.5 border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors"
                            >
                                <div className="text-sm text-foreground">{label}</div>
                                {(['in_app', 'browser', 'email'] as const).map((channel) => {
                                    const isEnabled = channels[channel] ?? defaults[channel] ?? true;
                                    const isMasterDisabled =
                                        (channel === 'browser' && !notifications.browserEnabled) ||
                                        (channel === 'email' && !notifications.emailEnabled);

                                    return (
                                        <div key={channel} className="flex justify-center">
                                            <ChannelCheckbox
                                                checked={isEnabled}
                                                disabled={saving || isMasterDisabled}
                                                onChange={(v) => handleChannelToggle(type, channel, v)}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>

                <Button
                    variant="ghost"
                    size="xs"
                    disabled={saving}
                    onClick={handleResetChannels}
                >
                    Reset to defaults
                </Button>
            </section>

            {/* Default Reminders */}
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

            {/* Quiet Hours */}
            <section className="space-y-4">
                <h2 className="text-lg font-semibold text-foreground">Quiet Hours</h2>
                <p className="text-sm text-muted-foreground">
                    Pause notifications during specific times. Coming soon.
                </p>

                <div className="bg-muted/50 rounded-lg border border-border p-4 text-center text-muted-foreground">
                    Quiet hours configuration will be available in a future update.
                </div>
            </section>
        </div>
    );
}

