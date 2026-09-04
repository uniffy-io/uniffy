import { useState, useCallback, useEffect, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { Kanban, Cpu, List, MagnifyingGlass } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { UserMenu } from "@/components/layout/UserMenu";
import { GlobalSearch } from "@/features/search/components/GlobalSearch";
import { NotificationBell } from "@/features/notifications/components/NotificationBell";
import { CalendarQuickView } from "@/features/calendar/components/quick-view/CalendarQuickView";
import { RecordingNavTrigger } from "@/features/recording/components/RecordingNavTrigger";
import { CallHeaderPill } from "@/features/calls/components/CallHeaderPill";
import { cn } from "@/shared/utils/cn";
import { UrnType } from "@/shared/utils/urn";
import { getContentTypeConfig } from "@/config/theme/contentTypes";
import { useAppSelector } from "@/app/hooks";
import { useAgentsBuilderAccess } from "@/features/agents/hooks/useAgentsBuilderAccess";
import { UniffyLogo } from "@/components/ui/uniffy-logo";
import { Drawer } from "@/components/ui/drawer";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { preloadChatPage } from "@/features/chat/pages/chatPageLoader";
import { loadLastOpenedChannel } from "@/features/chat/utils/lastOpenedChannel";
import {
  preloadAgentsPage,
  preloadCalendarPage,
  preloadDashboard,
  preloadFilesPage,
  preloadNotesPage,
  preloadProjectsPage,
} from "@/app/mainRouteLoaders";

const noteConfig = getContentTypeConfig(UrnType.NOTE);
const fileConfig = getContentTypeConfig(UrnType.FILE);
const chatConfig = getContentTypeConfig(UrnType.CHAT);
const calendarConfig = getContentTypeConfig(UrnType.CALENDAR_EVENT);

interface NavItem {
  name: string;
  path: string;
  icon: Icon;
  preload?: () => void;
}

// Nav paths (`/chat`) differ from URN paths (`/chats/{id}`) so we keep the override here.
const navItems: NavItem[] = [
  {
    name: noteConfig.labelPlural,
    path: "/notes",
    icon: noteConfig.icon,
    preload: preloadNotesPage,
  },
  {
    name: fileConfig.labelPlural,
    path: "/files",
    icon: fileConfig.icon,
    preload: preloadFilesPage,
  },
  { name: "Chat", path: "/chat", icon: chatConfig.icon, preload: preloadChatPage },
  {
    name: "Calendar",
    path: "/calendar",
    icon: calendarConfig.icon,
    preload: preloadCalendarPage,
  },
  { name: "Projects", path: "/projects", icon: Kanban, preload: preloadProjectsPage },
  { name: "Agents", path: "/agents", icon: Cpu, preload: preloadAgentsPage },
];

// The builder surface is gated; non-builders never see the Agents entry.
function useVisibleNavItems(): NavItem[] {
  const { isBuilder } = useAgentsBuilderAccess();
  return useMemo(
    () => navItems.filter((item) => item.path !== "/agents" || isBuilder),
    [isBuilder],
  );
}

function LogoNavItem({ isActive }: { isActive: boolean }) {
  return (
    <Link
      to="/"
      onPointerEnter={preloadDashboard}
      onFocus={preloadDashboard}
      onPointerDown={preloadDashboard}
      className={cn(
        "group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-700 ease-out overflow-hidden",
        "hover:px-2.5",
        isActive && "text-foreground",
      )}
    >
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />

      <span
        className={cn(
          "relative z-10 flex items-center justify-center w-7 h-7 rounded-md transition-all duration-500 ease-out",
          isActive
            ? "border-2 border-primary/30"
            : "border border-border-nav text-muted-foreground group-hover:border-transparent group-hover:text-primary",
        )}
      >
        <UniffyLogo className="w-5 h-5 transition-all duration-500" />
      </span>

      <span
        className={cn(
          "relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out",
          "group-hover:ml-1.5 group-hover:max-w-24",
          isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
        )}
      >
        Home
      </span>
    </Link>
  );
}

function CompactNavItem({
  item,
  targetPath,
  isActive,
}: {
  item: NavItem;
  targetPath: string;
  isActive: boolean;
}) {
  const Icon = item.icon;

  return (
    <Link
      to={targetPath}
      onPointerEnter={item.preload}
      onFocus={item.preload}
      onPointerDown={item.preload}
      className={cn(
        "group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-700 ease-out overflow-hidden",
        "hover:px-2.5",
        isActive && "text-foreground",
      )}
    >
      <span
        className={cn(
          "absolute inset-0 rounded-lg transition-all duration-500",
          isActive ? "bg-primary/10" : "bg-transparent",
        )}
      />

      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />

      <span
        className={cn(
          "relative z-10 flex items-center justify-center w-7 h-7 rounded-md transition-all duration-500 ease-out",
          isActive
            ? "border border-primary/30 bg-primary/10 text-primary"
            : "border border-border-nav text-muted-foreground group-hover:border-transparent group-hover:text-primary",
        )}
      >
        <Icon size={20} weight={isActive ? "fill" : "duotone"} />
      </span>

      <span
        className={cn(
          "relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out",
          "group-hover:ml-1.5 group-hover:max-w-24",
          isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
        )}
      >
        {item.name}
      </span>
    </Link>
  );
}

function MobileNavDrawer({
  open,
  onClose,
  currentPath,
  chatPath,
}: {
  open: boolean;
  onClose: () => void;
  currentPath: string;
  chatPath: string;
}) {
  const visibleNavItems = useVisibleNavItems();
  return (
    <Drawer open={open} onClose={onClose} side="left" ariaLabel="Navigation" className="w-64">
      <div className="pt-12 px-3">
        <nav className="flex flex-col gap-0.5">
          <Link
            to="/"
            onPointerEnter={preloadDashboard}
            onFocus={preloadDashboard}
            onPointerDown={preloadDashboard}
            onClick={onClose}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              currentPath === "/"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <UniffyLogo className="w-5 h-5" />
            Home
          </Link>
          {visibleNavItems.map((item) => {
            const isActive = currentPath.startsWith(item.path);
            const targetPath = item.path === "/chat" ? chatPath : item.path;
            const NavIcon = item.icon;
            return (
              <Link
                key={item.path}
                to={targetPath}
                onPointerEnter={item.preload}
                onFocus={item.preload}
                onPointerDown={item.preload}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <NavIcon size={20} weight={isActive ? "fill" : "duotone"} />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>
    </Drawer>
  );
}

export function AppHeader() {
  const location = useLocation();
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const userId = useAppSelector((state) => state.auth.user?.id);
  const { isMobile } = useBreakpoint();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const visibleNavItems = useVisibleNavItems();
  const lastOpenedChannelId =
    organizationId && userId ? loadLastOpenedChannel(organizationId, userId) : null;
  const chatPath = lastOpenedChannelId ? `/chat/${lastOpenedChannelId}` : "/chat";

  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);

  useEffect(() => {
    if (location.pathname.startsWith("/chat")) return;

    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection;
    if (connection?.saveData) return;

    const hasIdleCallback = "requestIdleCallback" in window;
    const handle = hasIdleCallback
      ? window.requestIdleCallback(preloadChatPage, { timeout: 2_000 })
      : window.setTimeout(preloadChatPage, 500);

    return () => {
      if (hasIdleCallback) {
        window.cancelIdleCallback(handle);
      } else {
        window.clearTimeout(handle);
      }
    };
  }, [location.pathname]);

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-40 w-full transition-[height,opacity] duration-300 ease-in-out",
          isZenMode ? "h-0 opacity-0 delay-150 overflow-hidden" : "h-12 opacity-100 delay-0",
        )}
      >
        <div className="absolute inset-0 bg-nav/95 backdrop-blur-sm border-b border-border-strong shadow-[0_8px_24px_-16px_hsl(0_0%_0%_/_var(--edge-drop-strong))]" />

        <div className="relative flex h-12 items-center px-3 lg:px-4 justify-between">
          <div className="flex items-center gap-0.5 z-20">
            <div className="flex md:hidden items-center gap-0.5">
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="relative p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label="Open menu"
              >
                <List size={20} weight="bold" />
              </button>
              <LogoNavItem isActive={location.pathname === "/"} />
            </div>

            <nav className="hidden md:flex items-center gap-0.5">
              <LogoNavItem isActive={location.pathname === "/"} />
              {visibleNavItems.map((item) => {
                const isActive = location.pathname.startsWith(item.path);
                const targetPath = item.path === "/chat" ? chatPath : item.path;
                return (
                  <CompactNavItem
                    key={item.path}
                    item={item}
                    targetPath={targetPath}
                    isActive={isActive}
                  />
                );
              })}
            </nav>
          </div>

          <div
            className={cn(
              "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10",
              "hidden sm:block",
            )}
          >
            <GlobalSearch />
          </div>

          <div className="flex items-center gap-2 z-20">
            {isMobile && <MobileSearchButton />}
            <CallHeaderPill />
            <RecordingNavTrigger />
            <CalendarQuickView />
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
      </header>

      <MobileNavDrawer
        open={mobileMenuOpen}
        onClose={closeMobileMenu}
        currentPath={location.pathname}
        chatPath={chatPath}
      />
    </>
  );
}

function MobileSearchButton() {
  const handleClick = () => {
    // Trigger spotlight via the registered keyboard shortcut.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center justify-center w-7 h-7 rounded-md border border-border-nav text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors sm:hidden"
      aria-label="Search"
    >
      <MagnifyingGlass size={20} weight="duotone" />
    </button>
  );
}
