/**
 * Settings page - main entry point for user settings.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SettingsLayout, type SettingsSection } from '../components/SettingsLayout';
import { AppearanceSection } from '../components/AppearanceSection';
import { KeyboardShortcutsSection } from '../components/KeyboardShortcutsSection';
import { NotificationsSection } from '../components/NotificationsSection';
import { AccountSection } from '../components/AccountSection';
import { useSettings } from '../hooks/useSettings';

export function SettingsPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const sectionParam = searchParams.get('section') as SettingsSection | null;
    const [activeSection, setActiveSection] = useState<SettingsSection>(sectionParam || 'appearance');
    const { initializeSettings, initialized, loading, error, dismissError } = useSettings();

    // Sync section with URL
    useEffect(() => {
        if (sectionParam && sectionParam !== activeSection) {
            setActiveSection(sectionParam);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only sync when URL param changes
    }, [sectionParam]);

    const handleSectionChange = (section: SettingsSection) => {
        setActiveSection(section);
        setSearchParams({ section });
    };

    // Initialize settings on mount
    useEffect(() => {
        if (!initialized) {
            initializeSettings();
        }
    }, [initialized, initializeSettings]);

    const handleCreateProfile = () => {
        // TODO: Open create profile modal
        console.log('Create profile clicked');
    };

    // Show loading state
    if (loading && !initialized) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-muted-foreground">Loading settings...</p>
                </div>
            </div>
        );
    }

    // Render content based on active section
    const renderContent = () => {
        switch (activeSection) {
            case 'appearance':
                return <AppearanceSection />;
            case 'shortcuts':
                return <KeyboardShortcutsSection />;
            case 'notifications':
                return <NotificationsSection />;
            case 'profile':
                return <AccountSection />;
            case 'general':
                return (
                    <div className="space-y-4">
                        <h1 className="text-2xl font-bold text-foreground">General</h1>
                        <p className="text-muted-foreground">
                            General application settings. Coming soon.
                        </p>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="h-full bg-background">
            {/* Error banner */}
            {error && (
                <div className="bg-red-100 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 px-4 py-3">
                    <div className="flex items-center justify-between max-w-3xl mx-auto">
                        <span className="text-sm text-red-800 dark:text-red-200">{error}</span>
                        <button
                            type="button"
                            className="text-red-600 dark:text-red-400 hover:underline text-sm"
                            onClick={dismissError}
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
            )}

            <SettingsLayout
                activeSection={activeSection}
                onSectionChange={handleSectionChange}
                onCreateProfile={handleCreateProfile}
            >
                {renderContent()}
            </SettingsLayout>
        </div>
    );
}

export default SettingsPage;
