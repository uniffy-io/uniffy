/**
 * Admin Layout
 *
 * Unified admin layout with role-aware sidebar navigation.
 * Shows different sections based on user's admin permissions:
 * - Organization sections: visible to org admins and system admins
 * - Server sections: visible to system admins only
 */

import { Outlet, Link, useLocation, Navigate } from 'react-router-dom';
import { AppHeader } from '@/components/layout/AppHeader';
import { cn } from '@/utils/cn';
import { useAdminAccess } from '../hooks/useAdminHooks';
import {
    Users,
    UsersThree,
    ShieldCheck,
    Gear,
    Buildings,
    HardDrives,
} from '@phosphor-icons/react';

interface NavItem {
    name: string;
    path: string;
    icon: React.ComponentType<{ className?: string; size?: number; weight?: string }>;
}

const orgNavItems: NavItem[] = [
    { name: 'Members', path: '/admin/members', icon: Users },
    { name: 'Groups', path: '/admin/groups', icon: UsersThree },
    { name: 'Permissions', path: '/admin/permissions', icon: ShieldCheck },
    { name: 'Organization', path: '/admin/org-settings', icon: Gear },
];

const serverNavItems: NavItem[] = [
    { name: 'Organizations', path: '/admin/organizations', icon: Buildings },
    { name: 'Users', path: '/admin/users', icon: Users },
    { name: 'Settings', path: '/admin/server-settings', icon: HardDrives },
];

function NavSection({
    title,
    items,
    currentPath,
}: {
    title: string;
    items: NavItem[];
    currentPath: string;
}) {
    return (
        <div className="space-y-1">
            <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {title}
            </div>
            {items.map((item) => {
                const Icon = item.icon;
                const isActive = currentPath === item.path || currentPath.startsWith(item.path + '/');
                return (
                    <Link
                        key={item.path}
                        to={item.path}
                        className={cn(
                            'flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors',
                            isActive
                                ? 'bg-primary text-primary-foreground'
                                : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                        )}
                    >
                        <Icon size={20} weight="duotone" />
                        {item.name}
                    </Link>
                );
            })}
        </div>
    );
}

export function AdminLayout() {
    const location = useLocation();
    const { canAccessAdmin, canAccessOrgSection, canAccessServerSection } = useAdminAccess();

    // Redirect non-admins to home
    if (!canAccessAdmin) {
        return <Navigate to="/" replace />;
    }

    return (
        <div className="min-h-screen bg-background text-foreground font-sans antialiased">
            <AppHeader />
            <div className="container mx-auto py-6 px-4 flex flex-col md:flex-row gap-8">
                <aside className="w-full md:w-64 shrink-0">
                    <nav className="space-y-6">
                        {/* Organization Admin Section */}
                        {canAccessOrgSection && (
                            <NavSection
                                title="Organization"
                                items={orgNavItems}
                                currentPath={location.pathname}
                            />
                        )}

                        {/* Server Admin Section */}
                        {canAccessServerSection && (
                            <NavSection
                                title="Server"
                                items={serverNavItems}
                                currentPath={location.pathname}
                            />
                        )}
                    </nav>
                </aside>

                <main className="flex-1 min-w-0">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
