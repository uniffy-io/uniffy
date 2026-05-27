import { useCallback } from 'react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { updateUser } from '@/features/auth/store/authSlice';
import { usersApi } from '@/features/settings/api/usersApi';
import { getInitials } from '@/components/subject/utils';
import { AvatarUpload } from '@/components/ui/avatar-upload';

export function AccountSection() {
    const dispatch = useAppDispatch();
    const { user } = useAppSelector((state) => state.auth);

    const handleUpload = useCallback(async (file: File) => {
        const buffer = await file.arrayBuffer();
        const imageData = new Uint8Array(buffer);
        const profile = await usersApi.uploadAvatar(imageData, file.name);
        // hasAvatar gates every avatar consumer; flip it locally so they stop rendering initials before the next GetCurrentUser.
        dispatch(updateUser({ avatarUrl: profile.avatarUrl, hasAvatar: true }));
    }, [dispatch]);

    const handleDelete = useCallback(async () => {
        await usersApi.deleteAvatar();
        dispatch(updateUser({ avatarUrl: '', hasAvatar: false }));
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

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-xl md:text-2xl font-bold text-foreground mb-2">Account</h1>
                <p className="text-sm text-muted-foreground">
                    View your account information.
                </p>
            </div>

            <section className="space-y-4">
                <h2 className="text-lg font-semibold text-foreground">Avatar</h2>
                <div className="bg-card rounded-lg border border-border p-4 md:p-6">
                    <AvatarUpload
                        imageUrl={user.avatarUrl || undefined}
                        fallback={displayInitials}
                        onUpload={handleUpload}
                        onDelete={handleDelete}
                    />
                </div>
            </section>

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

        </div>
    );
}
