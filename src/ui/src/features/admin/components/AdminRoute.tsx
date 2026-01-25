/**
 * AdminRoute - Protected route wrapper for admin pages.
 *
 * Allows access for:
 * - Organization admins (ADMIN or OWNER role in current org)
 * - System admins
 *
 * Redirects to login if not authenticated, or home if not an admin.
 */

import { Navigate, useLocation } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';
import { useAdminAccess } from '../hooks/useAdminHooks';

interface AdminRouteProps {
    children: React.ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps) {
    const isAuthenticated = useAppSelector((state) => state.auth?.isAuthenticated ?? false);
    const isRehydrating = useAppSelector((state) => state.auth?.isRehydrating ?? false);
    const refreshToken = useAppSelector((state) => state.auth?.refreshToken);
    const location = useLocation();
    const { canAccessAdmin } = useAdminAccess();

    // Wait for auth rehydration to complete before making redirect decisions
    if (isRehydrating || (!isAuthenticated && refreshToken)) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-background">
                <div className="text-muted-foreground">Loading...</div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/auth" state={{ from: location }} replace />;
    }

    // Check if user can access admin (org admin or system admin)
    if (!canAccessAdmin) {
        return <Navigate to="/" replace />;
    }

    return <>{children}</>;
}
