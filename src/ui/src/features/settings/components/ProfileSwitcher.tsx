/**
 * Profile switcher component for selecting active settings profile.
 */

import React from 'react';
import { ChevronDownIcon, CheckIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useSettings } from '../hooks/useSettings';

interface ProfileSwitcherProps {
    onCreateProfile?: () => void;
}

export function ProfileSwitcher({ onCreateProfile }: ProfileSwitcherProps) {
    const { profiles, activeProfile, switchProfile, loading } = useSettings();
    const [isOpen, setIsOpen] = React.useState(false);

    const handleSelect = async (profileId: string) => {
        setIsOpen(false);
        await switchProfile(profileId);
    };

    return (
        <div className="relative">
            <button
                type="button"
                className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg text-sm font-medium text-foreground hover:bg-muted/80 transition-colors"
                onClick={() => setIsOpen(!isOpen)}
                disabled={loading}
            >
                <span>{activeProfile?.name ?? 'Select Profile'}</span>
                <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
            </button>

            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Dropdown */}
                    <div className="absolute left-0 top-full mt-1 w-48 bg-card border border-border rounded-lg shadow-lg z-20">
                        <div className="py-1">
                            {profiles.map((profile) => (
                                <button
                                    key={profile.id}
                                    type="button"
                                    className="flex items-center justify-between w-full px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                                    onClick={() => handleSelect(profile.id)}
                                >
                                    <span className="flex items-center gap-2">
                                        {profile.name}
                                        {profile.isDefault && (
                                            <span className="text-xs text-muted-foreground">(Default)</span>
                                        )}
                                    </span>
                                    {profile.id === activeProfile?.id && (
                                        <CheckIcon className="h-4 w-4 text-primary" />
                                    )}
                                </button>
                            ))}

                            {onCreateProfile && (
                                <>
                                    <div className="border-t border-border my-1" />
                                    <button
                                        type="button"
                                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
                                        onClick={() => {
                                            setIsOpen(false);
                                            onCreateProfile();
                                        }}
                                    >
                                        <PlusIcon className="h-4 w-4" />
                                        <span>Create Profile</span>
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

export default ProfileSwitcher;
