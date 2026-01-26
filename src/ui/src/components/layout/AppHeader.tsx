import { Link, useLocation } from 'react-router-dom';
import {
  SquaresFour,
  NotePencil,
  FolderSimple,
  ChatTeardrop,
  CalendarDots,
  Kanban,
  TreeStructure,
} from '@phosphor-icons/react';
import { UserMenu } from './UserMenu';
import { GlobalSearch } from '@/features/search';
import { cn } from '@/utils/cn';

const navItems = [
  { name: 'Dashboard', path: '/', icon: SquaresFour },
  { name: 'Notes', path: '/notes', icon: NotePencil },
  { name: 'Files', path: '/files', icon: FolderSimple },
  { name: 'Chat', path: '/chat', icon: ChatTeardrop },
  { name: 'Calendar', path: '/calendar', icon: CalendarDots },
  { name: 'Projects', path: '/projects', icon: Kanban },
  { name: 'Workflows', path: '/workflows', icon: TreeStructure },
];

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
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground group-hover:text-primary"
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

export function AppHeader() {
  const location = useLocation();

  return (
    <header className="sticky top-0 z-40 w-full">
      {/* Background */}
      <div className="absolute inset-0 bg-background/95 backdrop-blur-sm border-b border-border" />

      <div className="relative flex h-12 items-center justify-between px-3 lg:px-4">
        {/* Left: Logo + Navigation */}
        <div className="flex items-center gap-1.5 lg:gap-3">
          {/* Logo */}
          <Link
            to="/"
            className="group flex items-center gap-2 flex-shrink-0 pr-1.5 lg:pr-3"
          >
            {/* Logo container */}
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold transition-transform duration-200 group-hover:scale-105 group-active:scale-95">
              <span className="text-sm">U</span>
            </div>

            <div className="hidden sm:flex flex-col">
              <span className="font-semibold text-sm tracking-tight leading-none text-foreground">
                UWOS
              </span>
              <span className="text-[9px] text-muted-foreground font-medium tracking-wider uppercase">
                Workspace
              </span>
            </div>
          </Link>

          {/* Separator */}
          <div className="hidden md:block h-5 w-px bg-border" />

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-0.5">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path ||
                               (item.path !== '/' && location.pathname.startsWith(item.path));

              return (
                <CompactNavItem key={item.path} item={item} isActive={isActive} />
              );
            })}
          </nav>

          {/* Mobile: Show only icons */}
          <nav className="flex md:hidden items-center gap-0.5">
            {navItems.slice(0, 5).map((item) => {
              const isActive = location.pathname === item.path ||
                               (item.path !== '/' && location.pathname.startsWith(item.path));
              const Icon = item.icon;

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "relative p-1.5 rounded-md transition-all duration-200",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon size={18} weight={isActive ? "fill" : "duotone"} />
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right: Search + User */}
        <div className="flex items-center gap-2">
          <GlobalSearch />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
