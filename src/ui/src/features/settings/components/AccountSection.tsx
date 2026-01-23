/**
 * Account settings section - displays user account information.
 */

import { useAppSelector } from '@/app/hooks';

export function AccountSection() {
    const { user } = useAppSelector((state) => state.auth);

    if (!user) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="text-muted-foreground">Loading...</div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-2xl font-bold text-foreground mb-2">Account</h1>
                <p className="text-muted-foreground">
                    View your account information and status.
                </p>
            </div>

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
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                        Verified
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                                        Unverified
                                    </span>
                                )}
                            </span>
                        </div>
                        <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm font-medium text-muted-foreground">Account Status</span>
                            <span>
                                {user.isActive ? (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                        Active
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
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

            {/* Security Section */}
            <section className="space-y-4">
                <h2 className="text-lg font-semibold text-foreground">Security</h2>
                <div className="bg-card rounded-lg border border-border p-4">
                    <p className="text-sm text-muted-foreground">
                        Password management and two-factor authentication settings coming soon.
                    </p>
                </div>
            </section>
        </div>
    );
}

export default AccountSection;
