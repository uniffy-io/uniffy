/**
 * Organization Settings Page
 *
 * Organization-level settings like name, logo, etc.
 * This is a placeholder for future functionality.
 */

import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Buildings, Gear } from '@phosphor-icons/react';

export default function OrgSettingsPage() {
    useDocumentTitle('Organization Settings');

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <div className="flex items-center gap-3 mb-2">
                    <Gear size={24} weight="duotone" className="text-primary" />
                    <h1 className="text-2xl font-bold">Organization Settings</h1>
                </div>
                <p className="text-muted-foreground">
                    Configure organization-wide settings and preferences.
                </p>
            </div>

            {/* Coming Soon Placeholder */}
            <div className="py-16 text-center border border-dashed border-border rounded-xl">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-primary/10 mb-4">
                    <Buildings size={32} weight="duotone" className="text-primary" />
                </div>
                <h2 className="text-lg font-semibold mb-2">Coming Soon</h2>
                <p className="text-muted-foreground max-w-sm mx-auto">
                    Organization settings like name, logo, and other preferences
                    will be configurable here.
                </p>
            </div>
        </div>
    );
}
