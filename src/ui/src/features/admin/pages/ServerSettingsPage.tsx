/**
 * Server Settings Page
 *
 * System-wide server configuration (for system admins).
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useTheme } from "@/config/theme/ThemeProvider";
import { Button } from "@/components/ui/button";
import { friendlyErrorMessage } from "@/config";
import { systemConfigApi } from "@/features/platform/api/systemConfigApi";
import {
    HardDrives,
    ShieldCheck,
    UsersThree,
    Bell,
    PaintBrush,
    Envelope,
    Key,
    Desktop,
    Sun,
    Moon,
} from '@phosphor-icons/react';
import { cn } from "@/shared/utils/cn";

interface ToggleSwitchProps {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    disabled?: boolean;
}

function ToggleSwitch({ enabled, onChange, disabled }: ToggleSwitchProps) {
    return (
        <button
            type="button"
            onClick={() => !disabled && onChange(!enabled)}
            disabled={disabled}
            className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ease-in-out",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                enabled
                    ? "bg-gradient-to-r from-blue-500 to-blue-600 shadow-sm shadow-blue-500/25"
                    : "bg-muted/80"
            )}
        >
            <span
                className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform duration-300 ease-in-out",
                    enabled ? "translate-x-6" : "translate-x-1"
                )}
            />
        </button>
    );
}

interface SettingItemProps {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    description: string;
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    badge?: string;
    disabled?: boolean;
}

function SettingItem({ icon: Icon, title, description, enabled, onChange, badge, disabled }: SettingItemProps) {
    return (
        <div className="group relative overflow-hidden rounded-xl border border-border bg-card hover:border-primary/50 transition-all duration-300 hover:shadow-md hover:shadow-primary/5">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="relative flex items-center justify-between p-3 md:p-5">
                <div className="flex items-start gap-4 flex-1">
                    <div className="rounded-lg bg-primary/10 p-2.5 group-hover:bg-primary/20 transition-colors duration-300">
                        <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <div className="font-semibold text-foreground">{title}</div>
                            {badge && (
                                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-primary/10 text-primary border border-primary/20">
                                    {badge}
                                </span>
                            )}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">{description}</div>
                    </div>
                </div>
                <ToggleSwitch enabled={enabled} onChange={onChange} disabled={disabled} />
            </div>
        </div>
    );
}

export function ServerSettingsPage() {
    useDocumentTitle('Server Settings');
    const { themeMode, availableModes, setTheme } = useTheme();

    // Wired flags resolved through `superadmin.v1.SystemConfigService`:
    // deployment_settings row > env default > coded default.
    const [publicRegistration, setPublicRegistrationState] = useState(false);
    const [publicRegistrationSource, setPublicRegistrationSource] = useState<string>('default');
    const [publicRegistrationLoading, setPublicRegistrationLoading] = useState(true);
    const [publicRegistrationSaving, setPublicRegistrationSaving] = useState(false);

    // Placeholder toggles -- visual only until wired the same way as
    // public registration. Local state matches the rendered switch but is
    // not persisted anywhere yet.
    const [maintenanceMode, setMaintenanceMode] = useState(false);
    const [emailNotifications, setEmailNotifications] = useState(true);
    const [twoFactorRequired, setTwoFactorRequired] = useState(false);
    const [auditLogging, setAuditLogging] = useState(true);
    const [apiRateLimiting, setApiRateLimiting] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setPublicRegistrationLoading(true);
            try {
                const response = await systemConfigApi.getSystemConfig({});
                const flag = response.config?.publicRegistration;
                if (!cancelled && flag) {
                    setPublicRegistrationState(flag.enabled);
                    setPublicRegistrationSource(flag.source || 'default');
                }
            } catch (err) {
                const friendly = friendlyErrorMessage((err as Error).message);
                if (friendly) toast.error(friendly);
            } finally {
                if (!cancelled) setPublicRegistrationLoading(false);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    const handlePublicRegistrationChange = useCallback(async (enabled: boolean) => {
        const previous = publicRegistration;
        setPublicRegistrationState(enabled);
        setPublicRegistrationSaving(true);
        try {
            const response = await systemConfigApi.setPublicRegistration({ enabled });
            const flag = response.config?.publicRegistration;
            if (flag) {
                setPublicRegistrationState(flag.enabled);
                setPublicRegistrationSource(flag.source || 'default');
            }
            toast.success(`Public registration ${enabled ? 'enabled' : 'disabled'}`);
        } catch (err) {
            setPublicRegistrationState(previous);
            const friendly = friendlyErrorMessage((err as Error).message);
            if (friendly) toast.error(friendly);
        } finally {
            setPublicRegistrationSaving(false);
        }
    }, [publicRegistration]);

    return (
        <div className="flex flex-col gap-6 max-w-3xl w-full mx-auto">
            <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                    <HardDrives size={22} weight="duotone" className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                    <h1 className="text-xl font-semibold text-foreground">Server settings</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Configure global system behavior and preferences.
                    </p>
                </div>
            </div>

            {/* Theme Selector Card */}
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300">
                <div className="border-b border-border bg-muted/30 px-4 md:px-6 py-3 md:py-4">
                    <div className="flex items-center gap-3">
                        <PaintBrush size={20} weight="duotone" className="text-primary" />
                        <div>
                            <h3 className="text-lg font-semibold text-foreground">Default Appearance</h3>
                            <p className="text-sm text-muted-foreground">Set the default theme for new users</p>
                        </div>
                    </div>
                </div>
                <div className="p-4 md:p-6">
                    <div className="flex gap-2 md:gap-3">
                        {availableModes.map((mode) => {
                            const Icon = mode === 'dark' ? Moon : mode === 'light' ? Sun : Desktop;
                            return (
                                <button
                                    key={mode}
                                    onClick={() => setTheme(mode)}
                                    className={cn(
                                        "flex-1 rounded-lg border-2 p-4 transition-all duration-300 hover:scale-[1.02]",
                                        themeMode === mode
                                            ? "border-primary bg-primary/10 shadow-md shadow-primary/20"
                                            : "border-border bg-card hover:border-primary/30 hover:bg-accent/50"
                                    )}
                                >
                                    <div className="flex flex-col items-center gap-2">
                                        <Icon size={24} weight="duotone" className="text-muted-foreground" />
                                        <span className="text-sm font-medium capitalize">{mode}</span>
                                        {themeMode === mode && (
                                            <span className="text-xs text-primary font-medium">Active</span>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Security & Access Section */}
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300">
                <div className="border-b border-border bg-muted/30 px-4 md:px-6 py-3 md:py-4">
                    <div className="flex items-center gap-3">
                        <ShieldCheck size={20} weight="duotone" className="text-primary" />
                        <div>
                            <h3 className="text-lg font-semibold text-foreground">Security & Access</h3>
                            <p className="text-sm text-muted-foreground">Control authentication and user access settings</p>
                        </div>
                    </div>
                </div>
                <div className="p-4 md:p-6 space-y-3">
                    <SettingItem
                        icon={HardDrives}
                        title="Maintenance Mode"
                        description="Temporarily disable access for non-admin users during system updates"
                        enabled={maintenanceMode}
                        onChange={setMaintenanceMode}
                        badge={maintenanceMode ? "Active" : undefined}
                    />
                    <SettingItem
                        icon={UsersThree}
                        title="Public Registration"
                        description="Allow new users to create accounts without an invite"
                        enabled={publicRegistration}
                        onChange={(value) => void handlePublicRegistrationChange(value)}
                        disabled={publicRegistrationLoading || publicRegistrationSaving}
                        badge={publicRegistrationLoading ? 'Loading' : publicRegistrationSource}
                    />
                    <SettingItem
                        icon={Key}
                        title="Require Two-Factor Authentication"
                        description="Enforce 2FA for all user accounts to enhance security"
                        enabled={twoFactorRequired}
                        onChange={setTwoFactorRequired}
                    />
                </div>
            </div>

            {/* System & Monitoring Section */}
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300">
                <div className="border-b border-border bg-muted/30 px-4 md:px-6 py-3 md:py-4">
                    <div className="flex items-center gap-3">
                        <HardDrives size={20} weight="duotone" className="text-primary" />
                        <div>
                            <h3 className="text-lg font-semibold text-foreground">System & Monitoring</h3>
                            <p className="text-sm text-muted-foreground">Configure system behavior and tracking features</p>
                        </div>
                    </div>
                </div>
                <div className="p-4 md:p-6 space-y-3">
                    <SettingItem
                        icon={ShieldCheck}
                        title="Audit Logging"
                        description="Track and record all system activities for security compliance"
                        enabled={auditLogging}
                        onChange={setAuditLogging}
                        badge="Recommended"
                    />
                    <SettingItem
                        icon={HardDrives}
                        title="API Rate Limiting"
                        description="Protect against abuse by limiting API requests per user"
                        enabled={apiRateLimiting}
                        onChange={setApiRateLimiting}
                    />
                </div>
            </div>

            {/* Notifications Section */}
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300">
                <div className="border-b border-border bg-muted/30 px-4 md:px-6 py-3 md:py-4">
                    <div className="flex items-center gap-3">
                        <Bell size={20} weight="duotone" className="text-primary" />
                        <div>
                            <h3 className="text-lg font-semibold text-foreground">Notifications</h3>
                            <p className="text-sm text-muted-foreground">Manage system-wide notification preferences</p>
                        </div>
                    </div>
                </div>
                <div className="p-4 md:p-6 space-y-3">
                    <SettingItem
                        icon={Envelope}
                        title="Email Notifications"
                        description="Send email alerts for important system events and updates"
                        enabled={emailNotifications}
                        onChange={setEmailNotifications}
                    />
                </div>
            </div>

            {/* Actions Footer */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4 md:p-5">
                <div>
                    <div className="font-medium text-foreground">Need to reset settings?</div>
                    <div className="text-sm text-muted-foreground">Restore all settings to their default values</div>
                </div>
                <Button variant="outline" size="sm" className="shrink-0">
                    Reset to Defaults
                </Button>
            </div>
        </div>
    );
}
