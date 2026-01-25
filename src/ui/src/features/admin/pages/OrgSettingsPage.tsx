/**
 * Organization Settings Page
 *
 * Organization-level settings like name, logo, etc.
 * This is a placeholder for future functionality.
 */

import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { BuildingOfficeIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';

export default function OrgSettingsPage() {
    useDocumentTitle('Organization Settings - Administration');

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <div className="flex items-center gap-3 mb-2">
                    <Cog6ToothIcon className="h-6 w-6 text-primary" />
                    <h1 className="text-2xl font-bold">Organization Settings</h1>
                </div>
                <p className="text-muted-foreground">
                    Configure organization-wide settings and preferences.
                </p>
            </div>

            {/* Coming Soon Placeholder */}
            <div className="py-16 text-center border border-dashed border-border rounded-xl">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-primary/10 mb-4">
                    <BuildingOfficeIcon className="h-8 w-8 text-primary" />
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
