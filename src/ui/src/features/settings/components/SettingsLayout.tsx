/**
 * Settings layout component with sidebar navigation.
 *
 * Personal user preferences only - org admin functionality has moved to /admin.
 * Layout matches the AdminLayout pattern for visual consistency.
 */

import React from 'react';
import {
    PaintBrush,
    Key,
    Bell,
    UserCircle,
    Gear,
} from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { ProfileSwitcher } from '@/features/settings/components/ProfileSwitcher';

export type SettingsSection =
    | 'appearance'
    | 'shortcuts'
    | 'notifications'
    | 'profile'
    | 'general';

interface SettingsLayoutProps {
    activeSection: SettingsSection;
    onSectionChange: (section: SettingsSection) => void;
    onCreateProfile?: () => void;
    children: React.ReactNode;
}

const SECTIONS: { id: SettingsSection; label: string; icon: React.ElementType }[] = [
    { id: 'appearance', label: 'Appearance', icon: PaintBrush },
    { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Key },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'profile', label: 'Account', icon: UserCircle },
    { id: 'general', label: 'General', icon: Gear },
];

export function SettingsLayout({
    activeSection,
    onSectionChange,
    onCreateProfile,
    children,
}: SettingsLayoutProps) {
    return (
        <div className="flex flex-col md:flex-row gap-8">
            {/* Sidebar */}
            <aside className="w-full md:w-64 shrink-0">
                <nav className="space-y-6">
                    {/* Profile switcher */}
                    <div className="space-y-1">
                        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Settings Profile
                        </div>
                        <div className="px-3">
                            <ProfileSwitcher onCreateProfile={onCreateProfile} />
                        </div>
                    </div>

                    {/* Navigation */}
                    <div className="space-y-1">
                        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Preferences
                        </div>
                        {SECTIONS.map(({ id, label, icon: Icon }) => (
                            <button
                                key={id}
                                type="button"
                                className={cn(
                                    'flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm font-medium transition-colors',
                                    activeSection === id
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                                )}
                                onClick={() => onSectionChange(id)}
                            >
                                <Icon size={20} weight="duotone" />
                                <span>{label}</span>
                            </button>
                        ))}
                    </div>
                </nav>
            </aside>

            {/* Main content */}
            <main className="flex-1 min-w-0">
                {children}
            </main>
        </div>
    );
}
