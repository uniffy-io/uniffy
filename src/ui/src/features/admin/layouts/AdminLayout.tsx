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
import { cn } from '@/shared/utils/cn';
import { useAdminAccess } from '@/features/admin/hooks/useAdminHooks';
import type { Icon } from '@phosphor-icons/react';
import {
    Users,
    UsersThree,
    ShieldCheck,
    Gear,
    Door,
    Buildings,
    HardDrives,
} from '@phosphor-icons/react';

interface NavItem {
    name: string;
    path: string;
    icon: Icon;
}

const orgNavItems: NavItem[] = [
    { name: 'Members', path: '/admin/members', icon: Users },
    { name: 'Groups', path: '/admin/groups', icon: UsersThree },
    { name: 'Permissions', path: '/admin/permissions', icon: ShieldCheck },
    { name: 'Organization', path: '/admin/org-settings', icon: Gear },
    { name: 'Rooms', path: '/admin/rooms', icon: Door },
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
        <div className="flex md:flex-col gap-1 shrink-0">
            <div className="hidden md:block px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
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
                            'flex items-center gap-2 md:gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                            isActive
                                ? 'bg-primary text-primary-foreground'
                                : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                        )}
                    >
                        <Icon size={18} weight="duotone" className="shrink-0" />
                        <span className="hidden sm:inline">{item.name}</span>
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
        <div className="min-h-dvh bg-background text-foreground font-sans antialiased">
            <AppHeader />
            <div className="container mx-auto py-4 md:py-6 px-3 md:px-4 flex flex-col md:flex-row gap-4 md:gap-8">
                <aside className="w-full md:w-56 lg:w-64 shrink-0">
                    <nav className="flex md:flex-col gap-2 md:gap-6 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
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
