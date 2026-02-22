/**
 * Account settings section - displays user account information,
 * avatar management, and active sessions.
 */

import { useState, useRef, useCallback } from 'react';
import { Camera, Trash, SpinnerGap } from '@phosphor-icons/react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { updateUser } from '@/features/auth/store/authSlice';
import { usersApi } from '@/features/settings/api/usersApi';
import { SessionsSection } from '@/features/settings/components/SessionsSection';
import { cn } from '@/shared/utils/cn';
import { getInitials } from '@/components/subject/utils';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function AccountSection() {
    const dispatch = useAppDispatch();
    const { user } = useAppSelector((state) => state.auth);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // Reset file input so the same file can be re-selected
        event.target.value = '';

        // Validate file type
        if (!ALLOWED_TYPES.includes(file.type)) {
            setError('Please select a JPEG, PNG, WebP, or GIF image.');
            return;
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            setError('Image must be smaller than 5MB.');
            return;
        }

        setError(null);
        setUploading(true);

        try {
            const buffer = await file.arrayBuffer();
            const imageData = new Uint8Array(buffer);
            const profile = await usersApi.uploadAvatar(imageData, file.name);

            dispatch(updateUser({
                avatarUrl: profile.avatarUrl,
            }));
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to upload avatar';
            setError(message);
        } finally {
            setUploading(false);
        }
    }, [dispatch]);

    const handleDelete = useCallback(async () => {
        setError(null);
        setDeleting(true);

        try {
            await usersApi.deleteAvatar();
            dispatch(updateUser({ avatarUrl: '' }));
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to delete avatar';
            setError(message);
        } finally {
            setDeleting(false);
        }
    }, [dispatch]);

    if (!user) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="text-muted-foreground">Loading...</div>
            </div>
        );
    }

    const displayInitials = user.fullName
        ? getInitials(user.fullName)
        : (user.username || '??').slice(0, 2).toUpperCase();

    const hasAvatar = !!user.avatarUrl;
    const isProcessing = uploading || deleting;

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-2xl font-bold text-foreground mb-2">Account</h1>
                <p className="text-muted-foreground">
                    View your account information and manage sessions.
                </p>
            </div>

            {/* Avatar Section */}
            <section className="space-y-4">
                <h2 className="text-lg font-semibold text-foreground">Avatar</h2>
                <div className="bg-card rounded-lg border border-border p-6">
                    <div className="flex items-center gap-6">
                        {/* Avatar Preview */}
                        <div className="relative group">
                            <div className={cn(
                                "w-20 h-20 rounded-full overflow-hidden flex items-center justify-center",
                                "border-2 border-border",
                                !hasAvatar && "bg-muted"
                            )}>
                                {hasAvatar ? (
                                    <img
                                        src={user.avatarUrl}
                                        alt="Avatar"
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <span className="text-2xl font-bold text-muted-foreground">
                                        {displayInitials}
                                    </span>
                                )}
                                {isProcessing && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-background/60 rounded-full">
                                        <SpinnerGap size={24} className="animate-spin text-foreground" />
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Upload Controls */}
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isProcessing}
                                    className={cn(
                                        "inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md",
                                        "bg-primary text-primary-foreground",
                                        "hover:bg-primary/90 transition-colors",
                                        "disabled:opacity-50 disabled:cursor-not-allowed"
                                    )}
                                >
                                    <Camera size={14} weight="bold" />
                                    {hasAvatar ? 'Change' : 'Upload'}
                                </button>
                                {hasAvatar && (
                                    <button
                                        onClick={handleDelete}
                                        disabled={isProcessing}
                                        className={cn(
                                            "inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md",
                                            "border border-border text-muted-foreground",
                                            "hover-destructive",
                                            "transition-colors",
                                            "disabled:opacity-50 disabled:cursor-not-allowed"
                                        )}
                                    >
                                        <Trash size={14} weight="bold" />
                                        Remove
                                    </button>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                JPEG, PNG, WebP, or GIF. Max 5MB.
                            </p>
                        </div>
                    </div>

                    {error && (
                        <div className="mt-4 text-sm" style={{ color: 'var(--status-error)' }}>
                            {error}
                        </div>
                    )}

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={handleFileSelect}
                        className="hidden"
                    />
                </div>
            </section>

            {/* Account Information */}
            <section className="space-y-4">
                <h2 className="text-lg font-semibold text-foreground">Account Information</h2>
                <div className="bg-card rounded-lg border border-border overflow-hidden">
                    <div className="divide-y divide-border">
                        <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm font-medium text-muted-foreground">Full Name</span>
                            <span className="text-sm text-foreground font-medium">
                                {user.fullName || 'Not set'}
                            </span>
                        </div>
                        <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm font-medium text-muted-foreground">Username</span>
                            <span className="text-sm text-foreground font-medium">
                                {user.username}
                            </span>
                        </div>
                        <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm font-medium text-muted-foreground">Email</span>
                            <span className="text-sm text-foreground font-medium">
                                {user.email}
                            </span>
                        </div>
                    </div>
                </div>
            </section>

            {/* Account Status */}
            <section className="space-y-4">
                <h2 className="text-lg font-semibold text-foreground">Status</h2>
                <div className="bg-card rounded-lg border border-border overflow-hidden">
                    <div className="divide-y divide-border">
                        <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm font-medium text-muted-foreground">Email Status</span>
                            <span>
                                {user.emailVerified ? (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium status-success">
                                        Verified
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium status-warning">
                                        Unverified
                                    </span>
                                )}
                            </span>
                        </div>
                        <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm font-medium text-muted-foreground">Account Status</span>
                            <span>
                                {user.isActive ? (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium status-success">
                                        Active
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium status-error">
                                        Inactive
                                    </span>
                                )}
                            </span>
                        </div>
                        {user.isSystemAdmin && (
                            <div className="flex items-center justify-between px-4 py-3">
                                <span className="text-sm font-medium text-muted-foreground">Role</span>
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">
                                    System Admin
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* Sessions */}
            <SessionsSection />
        </div>
    );
}
