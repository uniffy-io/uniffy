import { Outlet, Link, useLocation, Navigate } from "react-router-dom";
import { useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { SupportSessionBanner } from "@/features/admin/components/support/SupportSessionBanner";
import { cn } from "@/shared/utils/cn";
import { useAdminAccess } from "@/features/admin/hooks/useAdminHooks";
import type { Icon } from "@phosphor-icons/react";
import {
  Users,
  UsersThree,
  ShieldCheck,
  Crown,
  Door,
  Database,
  Robot,
  ClipboardText,
  CaretRight,
  Key,
  Envelope,
  Phone,
  ChatCircle,
  LockKey,
  Lifebuoy,
  Plugs,
  PlugsConnected,
  TreeStructure,
} from "@phosphor-icons/react";

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

const orgGroups: NavGroup[] = [
  {
    id: "access",
    title: "Access",
    items: [
      { name: "Members", path: "/admin/members", icon: Users },
      { name: "Teams", path: "/admin/teams", icon: TreeStructure },
      { name: "Groups", path: "/admin/groups", icon: UsersThree },
      { name: "Directory", path: "/admin/people", icon: PlugsConnected },
      { name: "Domain Admins", path: "/admin/domain-admins", icon: Crown },
    ],
  },
  {
    id: "security",
    title: "Security",
    items: [
      { name: "Default Permissions", path: "/admin/permissions", icon: ShieldCheck },
      { name: "Authentication", path: "/admin/security", icon: LockKey },
      { name: "Encryption", path: "/admin/encryption", icon: Key },
      { name: "Support Access", path: "/admin/support-access", icon: Lifebuoy },
      { name: "Audit Log", path: "/admin/audit-logs", icon: ClipboardText },
    ],
  },
  {
    id: "workspace",
    title: "Workspace",
    items: [
      { name: "Agents", path: "/admin/agents", icon: Robot },
      { name: "Chat", path: "/admin/chat", icon: ChatCircle },
      { name: "Integrations", path: "/admin/integrations", icon: Plugs },
      { name: "Rooms", path: "/admin/rooms", icon: Door },
      { name: "Storage", path: "/admin/storage", icon: Database },
      { name: "Email", path: "/admin/email", icon: Envelope },
      { name: "Calls", path: "/admin/calls", icon: Phone },
    ],
  },
];

const COLLAPSED_STORAGE_KEY = "admin-nav-collapsed-groups";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

function saveCollapsed(s: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...s]));
  } catch {
    // ignore quota or privacy-mode failures
  }
}

function isItemActive(currentPath: string, itemPath: string): boolean {
  return currentPath === itemPath || currentPath.startsWith(itemPath + "/");
}

function NavItemLink({ item, currentPath }: { item: NavItem; currentPath: string }) {
  const Icon = item.icon;
  const active = isItemActive(currentPath, item.path);
  return (
    <Link
      to={item.path}
      className={cn(
        "flex items-center gap-2 md:gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap",
        active
          ? "bg-muted text-foreground"
          : "text-foreground/90 hover:bg-muted/60 hover:text-foreground",
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
          className={cn("transition-transform shrink-0", !collapsed && "rotate-90")}
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

export function AdminLayout() {
  const location = useLocation();
  const { canAccessAdmin } = useAdminAccess();
  const [collapsedPref, setCollapsedPref] = useState<Set<string>>(loadCollapsed);

  if (!canAccessAdmin) {
    return <Navigate to="/" replace />;
  }

  const visibleGroups: NavGroup[] = orgGroups;

  const activeGroupId = visibleGroups.find((g) =>
    g.items.some((i) => isItemActive(location.pathname, i.path)),
  )?.id;

  const isGroupCollapsed = (id: string): boolean => collapsedPref.has(id) && id !== activeGroupId;

  const toggleGroup = (id: string): void => {
    setCollapsedPref((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsed(next);
      return next;
    });
  };

  const flatItems = visibleGroups.flatMap((g) => g.items);

  return (
    <div className="min-h-dvh bg-background text-foreground font-sans antialiased [--sticky-top:3rem]">
      <AppHeader />
      <SupportSessionBanner />
      <div className="py-4 md:py-6 px-3 md:px-6 flex flex-col md:flex-row gap-4 md:gap-6">
        <aside className="w-full md:w-56 lg:w-64 shrink-0">
          <nav className="md:hidden flex gap-2 overflow-x-auto pb-2">
            {flatItems.map((item) => (
              <NavItemLink key={item.path} item={item} currentPath={location.pathname} />
            ))}
          </nav>
          <nav className="hidden md:flex md:flex-col gap-4">
            {visibleGroups.map((g) => (
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
