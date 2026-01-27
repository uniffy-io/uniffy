/**
 * Notifications settings section.
 */

import { useSettings, useNotificationSettings } from '../hooks/useSettings';

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

    const handleToggle = (field: string, value: boolean) => {
        updateSettings({
            notifications: { [field]: value },
        });
    };

    const handleFrequencyChange = (frequency: string) => {
        updateSettings({
            notifications: { emailFrequency: frequency },
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

            {/* Desktop Notifications */}
            <section className="space-y-4">
                <h2 className="text-lg font-semibold text-foreground">Desktop Notifications</h2>

                <div className="space-y-4 bg-card rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="font-medium text-foreground">Enable Desktop Notifications</div>
                            <div className="text-sm text-muted-foreground">
                                Show notifications in your system tray
                            </div>
                        </div>
                        <ToggleSwitch
                            enabled={notifications.desktopEnabled}
                            onChange={(v) => handleToggle('desktopEnabled', v)}
                            disabled={saving}
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

