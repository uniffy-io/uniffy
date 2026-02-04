/**
 * Settings layout component with sidebar navigation.
 *
 * Personal user preferences only - org admin functionality has moved to /admin.
 */

import React from 'react';
import {
    PaintBrush,
    Key,
    Bell,
    UserCircle,
    Gear,
} from '@phosphor-icons/react';
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
        <div className="flex h-full">
            {/* Sidebar */}
            <aside className="w-64 border-r border-border bg-card/50 flex flex-col">
                {/* Profile switcher header */}
                <div className="p-4 border-b border-border">
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        Settings Profile
                    </h2>
                    <ProfileSwitcher onCreateProfile={onCreateProfile} />
                </div>

                {/* Navigation */}
                <nav className="flex-1 p-2 overflow-y-auto">
                    {SECTIONS.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            type="button"
                            className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                activeSection === id
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-foreground hover:bg-muted'
                            }`}
                            onClick={() => onSectionChange(id)}
                        >
                            <Icon size={20} weight="duotone" />
                            <span>{label}</span>
                        </button>
                    ))}
                </nav>
            </aside>

            {/* Main content */}
            <main className="flex-1 overflow-auto">
                <div className="max-w-3xl mx-auto p-8">{children}</div>
            </main>
        </div>
    );
}

