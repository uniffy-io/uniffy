import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { SettingsLayout, type SettingsSection } from '@/features/settings/components/SettingsLayout';
import { AppearanceSection } from '@/features/settings/components/AppearanceSection';
import { KeyboardShortcutsSection } from '@/features/settings/components/KeyboardShortcutsSection';
import { NotificationsSection } from '@/features/settings/components/NotificationsSection';
import { AccountSection } from '@/features/settings/components/AccountSection';
import { SecuritySection } from '@/features/settings/components/SecuritySection';
import { useSettings } from '@/features/settings/hooks/useSettings';

export function SettingsPage() {
    useDocumentTitle('Settings');
    const [searchParams, setSearchParams] = useSearchParams();
    const sectionParam = searchParams.get('section') as SettingsSection | null;
    const [activeSection, setActiveSection] = useState<SettingsSection>(sectionParam || 'appearance');
    const { initializeSettings, initialized, loading, error, dismissError } = useSettings();

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

    useEffect(() => {
        if (!initialized) {
            initializeSettings();
        }
    }, [initialized, initializeSettings]);

    const handleCreateProfile = () => {
    };

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
            case 'security':
                return <SecuritySection />;
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
        <>
            {error && (
                <div className="mb-6 p-4 rounded-lg border status-error">
                    <div className="flex items-center justify-between">
                        <span className="text-sm" style={{ color: 'var(--status-error)' }}>{error}</span>
                        <button
                            type="button"
                            className="hover:underline text-sm"
                            style={{ color: 'var(--status-error)' }}
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
        </>
    );
}

