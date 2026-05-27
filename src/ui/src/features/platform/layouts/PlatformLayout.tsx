import { Outlet, Link, useLocation, Navigate } from 'react-router-dom';
import { useState } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { cn } from '@/shared/utils/cn';
import { useAdminAccess } from '@/features/admin/hooks/useAdminHooks';
import { useAppSelector } from '@/app/hooks';
import type { Icon } from '@phosphor-icons/react';
import {
    Buildings,
    Users,
    Envelope,
    Key,
    ClipboardText,
    HardDrives,
    Lifebuoy,
    CaretRight,
    ArrowLeft,
    ShieldWarning,
} from '@phosphor-icons/react';

interface NavItem {
    name: string;
    path: string;
    icon: Icon;
}

interface NavGroup {
    id: string;
    title: string;
    items: NavItem[];
}

const platformGroups: NavGroup[] = [
    {
        id: 'tenants',
        title: 'Tenants',
        items: [
            { name: 'Organizations', path: '/platform/organizations', icon: Buildings },
            { name: 'Users', path: '/platform/users', icon: Users },
            { name: 'Support Sessions', path: '/platform/sessions', icon: Lifebuoy },
        ],
    },
    {
        id: 'infrastructure',
        title: 'Infrastructure',
        items: [
            { name: 'Mail', path: '/platform/mail', icon: Envelope },
            { name: 'Encryption', path: '/platform/encryption', icon: Key },
            { name: 'Server Settings', path: '/platform/server-settings', icon: HardDrives },
        ],
    },
    {
        id: 'observability',
        title: 'Observability',
        items: [
            { name: 'Audit', path: '/platform/audit', icon: ClipboardText },
        ],
    },
];

const COLLAPSED_STORAGE_KEY = 'platform-nav-collapsed-groups';

function loadCollapsed(): Set<string> {
    try {
        const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter((v): v is string => typeof v === 'string'));
    } catch {
        return new Set();
    }
}

function saveCollapsed(s: Set<string>): void {
    try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...s]));
    } catch {
        // quota / privacy-mode: best-effort persistence
    }
}

function isItemActive(currentPath: string, itemPath: string): boolean {
    return currentPath === itemPath || currentPath.startsWith(itemPath + '/');
}

function NavItemLink({ item, currentPath }: { item: NavItem; currentPath: string }) {
    const Icon = item.icon;
    const active = isItemActive(currentPath, item.path);
    return (
        <Link
            to={item.path}
            className={cn(
                'flex items-center gap-2 md:gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                active
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground'
            )}
        >
            <Icon size={18} weight="duotone" className="shrink-0" />
            <span className="hidden sm:inline">{item.name}</span>
        </Link>
    );
}

function DesktopGroup({
    group,
    currentPath,
    collapsed,
    onToggle,
}: {
    group: NavGroup;
    currentPath: string;
    collapsed: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="flex flex-col gap-1">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={!collapsed}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors rounded-md w-full"
            >
                <CaretRight
                    size={12}
                    weight="bold"
                    className={cn('transition-transform shrink-0', !collapsed && 'rotate-90')}
                />
                <span>{group.title}</span>
            </button>
            {!collapsed && (
                <div className="flex flex-col gap-1 pl-1">
                    {group.items.map((item) => (
                        <NavItemLink key={item.path} item={item} currentPath={currentPath} />
                    ))}
                </div>
            )}
        </div>
    );
}

export function PlatformLayout() {
    const location = useLocation();
    const { isSystemAdmin } = useAdminAccess();
    const orgSlug = useAppSelector((state) => state.auth.currentOrganizationSlug);
    const [collapsedPref, setCollapsedPref] = useState<Set<string>>(loadCollapsed);

    // /platform/* is gated on is_system_admin (cloud operator), distinct from is_org_admin (tenant).
    if (!isSystemAdmin) {
        return <Navigate to="/" replace />;
    }

    const activeGroupId = platformGroups.find((g) =>
        g.items.some((i) => isItemActive(location.pathname, i.path))
    )?.id;

    const isGroupCollapsed = (id: string): boolean =>
        collapsedPref.has(id) && id !== activeGroupId;

    const toggleGroup = (id: string): void => {
        setCollapsedPref((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            saveCollapsed(next);
            return next;
        });
    };

    const flatItems = platformGroups.flatMap((g) => g.items);

    return (
        <div className="min-h-dvh bg-background text-foreground font-sans antialiased">
            <AppHeader />

            <div
                role="banner"
                className="relative border-b border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
            >
                <div className="absolute inset-x-0 top-0 h-0.5 bg-amber-500" />
                <div className="px-3 md:px-6 py-2 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                        <ShieldWarning size={16} weight="fill" className="shrink-0" />
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-amber-500 text-white">
                            Platform
                        </span>
                        <span className="text-xs md:text-sm truncate">
                            Cross-tenant operator surface. You are not inside any tenant.
                        </span>
                    </div>
                    {orgSlug && (
                        <Link
                            to="/admin"
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md hover:bg-amber-500/20 transition-colors"
                        >
                            <ArrowLeft size={14} weight="bold" />
                            <span>Return to /admin</span>
                        </Link>
                    )}
                </div>
            </div>

            <div className="py-4 md:py-6 px-3 md:px-6 flex flex-col md:flex-row gap-4 md:gap-6">
                <aside className="w-full md:w-56 lg:w-64 shrink-0">
                    <nav className="md:hidden flex gap-2 overflow-x-auto pb-2">
                        {flatItems.map((item) => (
                            <NavItemLink
                                key={item.path}
                                item={item}
                                currentPath={location.pathname}
                            />
                        ))}
                    </nav>
                    <nav className="hidden md:flex md:flex-col gap-4">
                        {platformGroups.map((g) => (
                            <DesktopGroup
                                key={g.id}
                                group={g}
                                currentPath={location.pathname}
                                collapsed={isGroupCollapsed(g.id)}
                                onToggle={() => toggleGroup(g.id)}
                            />
                        ))}
                    </nav>
                </aside>

                <main className="flex-1 min-w-0">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
