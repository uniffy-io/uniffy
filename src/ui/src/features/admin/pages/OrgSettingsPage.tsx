/**
 * Organization Settings Page
 *
 * Org-level toggles backed by `organization.settings` (JSONB). Initially
 * surfaces the `chat.agents_enabled` flag that gates the agents-in-chat
 * runtime; previously only settable via raw SQL.
 */

import { useEffect } from 'react';
import { ChatCircleText, Gear, Robot } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import {
    fetchOrganizationSettings,
    updateOrganizationSettings,
} from '@/features/admin/store/adminThunks';

export function OrgSettingsPage() {
    useDocumentTitle('Organization Settings');

    const dispatch = useAppDispatch();
    const settings = useAppSelector((s) => s.admin.orgSettings);
    const loading = useAppSelector((s) => s.admin.orgSettingsLoading);
    const saving = useAppSelector((s) => s.admin.orgSettingsSaving);
    const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);

    useEffect(() => {
        if (organizationId) {
            dispatch(fetchOrganizationSettings());
        }
    }, [dispatch, organizationId]);

    const agentsEnabled = settings?.chat.agentsEnabled ?? false;

    const handleToggleAgents = (next: boolean) => {
        dispatch(updateOrganizationSettings({ chat: { agentsEnabled: next } }));
    };

    return (
        <div className="space-y-6">
            <div>
                <div className="flex items-center gap-3 mb-2">
                    <Gear size={24} weight="duotone" className="text-primary" />
                    <h1 className="text-2xl font-bold">Organization Settings</h1>
                </div>
                <p className="text-muted-foreground">
                    Configure organization-wide features and preferences.
                </p>
            </div>

            <section className="border border-border rounded-xl bg-card">
                <header className="flex items-center gap-3 px-5 py-4 border-b border-border">
                    <ChatCircleText size={20} weight="duotone" className="text-violet-500" />
                    <div>
                        <h2 className="text-base font-semibold">Chat</h2>
                        <p className="text-xs text-muted-foreground">
                            Features that affect channels, DMs, and threads across the org.
                        </p>
                    </div>
                </header>

                <div className="flex items-start justify-between gap-6 px-5 py-4">
                    <div className="flex items-start gap-3 min-w-0">
                        <Robot size={20} weight="duotone" className="mt-0.5 text-amber-500 shrink-0" />
                        <div className="min-w-0">
                            <div className="text-sm font-medium">Agents in chat</div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Allow members to DM agents and trigger them in channels via
                                mentions, replies, or threads. When off, agents are hidden from
                                chat pickers and do not respond.
                            </p>
                        </div>
                    </div>
                    <ToggleSwitch
                        enabled={agentsEnabled}
                        onChange={handleToggleAgents}
                        disabled={loading || saving || !organizationId}
                    />
                </div>
            </section>
        </div>
    );
}
