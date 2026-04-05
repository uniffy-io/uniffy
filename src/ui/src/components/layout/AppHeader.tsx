import { useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Kanban, Cpu, List, MagnifyingGlass } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { UserMenu } from '@/components/layout/UserMenu';
import { GlobalSearch } from '@/features/search';
import { NotificationBell } from '@/features/notifications';
import { CalendarQuickView } from '@/features/calendar';
import { cn } from '@/shared/utils/cn';
import { UrnType } from '@/shared/utils/urn';
import { getContentTypeConfig } from '@/config/theme/contentTypes';
import { useAppSelector } from '@/app/hooks';
import { UniffyLogo } from '@/components/ui/uniffy-logo';
import { Drawer } from '@/components/ui/drawer';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';

// Get content type configs for nav items
const noteConfig = getContentTypeConfig(UrnType.NOTE);
const fileConfig = getContentTypeConfig(UrnType.FILE);
const chatConfig = getContentTypeConfig(UrnType.CHAT);
const calendarConfig = getContentTypeConfig(UrnType.CALENDAR_EVENT);

interface NavItem {
  name: string;
  path: string;
  icon: Icon;
}

// Nav items use icons from central config but may have custom paths/names
// (nav paths like /chat differ from URN paths like /chats/{id})
const navItems: NavItem[] = [
  { name: noteConfig.labelPlural, path: '/notes', icon: noteConfig.icon },
  { name: fileConfig.labelPlural, path: '/files', icon: fileConfig.icon },
  { name: 'Chat', path: '/chat', icon: chatConfig.icon },
  { name: 'Calendar', path: '/calendar', icon: calendarConfig.icon },
  { name: 'Projects', path: '/projects', icon: Kanban },
  { name: 'Agents', path: '/agents', icon: Cpu },
];

// Logo nav item for home/dashboard
function LogoNavItem({ isActive }: { isActive: boolean }) {

  return (
    <Link
      to="/"
      className={cn(
        "group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-700 ease-out overflow-hidden",
        "hover:px-2.5",
        isActive && "text-foreground"
      )}
    >
      {/* Hover underline effect */}
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />

      {/* Logo */}
      <span className={cn(
        "relative z-10 flex items-center justify-center w-7 h-7 rounded-md transition-all duration-500 ease-out",
        isActive
          ? "border-2 border-primary/30"
          : "border border-border text-muted-foreground group-hover:border-transparent group-hover:text-primary"
      )}>
        <UniffyLogo
          className="w-5 h-5 transition-all duration-500"
          variant={isActive ? 'dark' : undefined}
        />
      </span>

      {/* Label - hidden by default, shows on hover */}
      <span className={cn(
        "relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out",
        "group-hover:ml-1.5 group-hover:max-w-24",
        isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
      )}>
        Home
      </span>
    </Link>
  );
}

// Nav item that expands on hover to show label
function CompactNavItem({ item, isActive }: { item: typeof navItems[0]; isActive: boolean }) {
  const Icon = item.icon;

  return (
    <Link
      to={item.path}
      className={cn(
        "group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-700 ease-out overflow-hidden",
        "hover:px-2.5",
        isActive && "text-foreground"
      )}
    >
      {/* Active indicator */}
      <span
        className={cn(
          "absolute inset-0 rounded-lg transition-all duration-500",
          isActive ? "bg-primary/10" : "bg-transparent"
        )}
      />

      {/* Hover underline effect */}
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />

      {/* Icon */}
      <span className={cn(
        "relative z-10 flex items-center justify-center w-7 h-7 rounded-md transition-all duration-500 ease-out",
        isActive
          ? "border border-primary/30 bg-primary/10 text-primary"
          : "border border-border text-muted-foreground group-hover:border-transparent group-hover:text-primary"
      )}>
        <Icon size={20} weight={isActive ? "fill" : "duotone"} />
      </span>

      {/* Label - hidden by default, shows on hover */}
      <span className={cn(
        "relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out",
        "group-hover:ml-1.5 group-hover:max-w-24",
        isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
      )}>
        {item.name}
      </span>
    </Link>
  );
}

// Full-screen mobile navigation drawer
function MobileNavDrawer({
  open,
  onClose,
  currentPath,
}: {
  open: boolean;
  onClose: () => void;
  currentPath: string;
}) {
  return (
    <Drawer open={open} onClose={onClose} side="left" ariaLabel="Navigation" className="w-64">
      <div className="pt-12 px-3">
        <nav className="flex flex-col gap-0.5">
          <Link
            to="/"
            onClick={onClose}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              currentPath === '/'
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <UniffyLogo className="w-5 h-5" />
            Home
          </Link>
          {navItems.map((item) => {
            const isActive = currentPath.startsWith(item.path);
            const NavIcon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
  const { isMobile } = useBreakpoint();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-40 w-full transition-[height,opacity] duration-300 ease-in-out",
          isZenMode ? "h-0 opacity-0 delay-150 overflow-hidden" : "h-12 opacity-100 delay-0"
        )}
      >
        {/* Background */}
        <div className="absolute inset-0 bg-background/95 backdrop-blur-sm border-b border-border" />

        <div className="relative flex h-12 items-center px-3 lg:px-4 justify-between">
          {/* Left: Navigation */}
          <div className="flex items-center gap-0.5 z-20">
            {/* Mobile: Hamburger + Logo */}
            <div className="flex md:hidden items-center gap-0.5">
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="relative p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label="Open menu"
              >
                <List size={20} weight="bold" />
              </button>
              <LogoNavItem isActive={location.pathname === '/'} />
            </div>

            {/* Desktop/Tablet Navigation - all items visible */}
            <nav className="hidden md:flex items-center gap-0.5">
              <LogoNavItem isActive={location.pathname === '/'} />
              {navItems.map((item) => {
                const isActive = location.pathname.startsWith(item.path);
                return (
                  <CompactNavItem key={item.path} item={item} isActive={isActive} />
                );
              })}
            </nav>
          </div>

          {/* Center: Search - hidden on mobile, shown on tablet+ */}
          <div className={cn(
            "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10",
            "hidden sm:block"
          )}>
            <GlobalSearch />
          </div>

          {/* Right: Search (mobile) + Notifications + User */}
          <div className="flex items-center gap-2 z-20">
            {/* Mobile search icon - opens spotlight instead */}
            {isMobile && (
              <MobileSearchButton />
            )}
            <CalendarQuickView />
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
      </header>

      {/* Mobile nav drawer */}
      <MobileNavDrawer
        open={mobileMenuOpen}
        onClose={closeMobileMenu}
        currentPath={location.pathname}
      />
    </>
  );
}

/** On mobile, show a search icon that triggers spotlight search */
function MobileSearchButton() {
  const handleClick = () => {
    // Trigger spotlight search via keyboard shortcut dispatch
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center justify-center w-7 h-7 rounded-md border border-border text-muted-foreground hover:text-primary hover:border-border transition-colors sm:hidden"
      aria-label="Search"
    >
      <MagnifyingGlass size={20} weight="duotone" />
    </button>
  );
}
