import { Link, useLocation } from 'react-router-dom';
import { 
  DocumentTextIcon, 
  ChatBubbleLeftRightIcon, 
  FolderIcon, 
  CalendarIcon, 
  BookOpenIcon, 
  KeyIcon,
  Squares2X2Icon,
  FolderOpenIcon,
  SparklesIcon,
  CogIcon
} from '@heroicons/react/24/outline';
import { UserMenu } from './UserMenu';
import { GlobalSearch } from '@/features/search';
import { cn } from '@/utils/cn';

const navItems = [
  { name: 'Dashboard', path: '/', icon: Squares2X2Icon },
  { name: 'Notes', path: '/notes', icon: DocumentTextIcon },
  { name: 'Files', path: '/files', icon: FolderIcon },
  { name: 'Chat', path: '/chat', icon: ChatBubbleLeftRightIcon },
  { name: 'Calendar', path: '/calendar', icon: CalendarIcon },
  { name: 'Library', path: '/library', icon: BookOpenIcon },
  { name: 'Vault', path: '/vault', icon: KeyIcon },
  { name: 'Projects', path: '/projects', icon: FolderOpenIcon },
  { name: 'Assistants', path: '/assistants', icon: SparklesIcon },
  { name: 'Workflows', path: '/workflows', icon: CogIcon },
];

export function AppHeader() {
  const location = useLocation();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background">
      <div className="flex h-14 items-center justify-between pl-6 pr-4">
        <div className="flex items-center gap-3 md:gap-4">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-1.5 flex-shrink-0">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold shadow-sm">
              U
            </div>
            <span className="hidden font-bold sm:inline-block text-lg tracking-tight whitespace-nowrap">UWOS</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="flex items-center gap-0.5">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path || 
                               (item.path !== '/' && location.pathname.startsWith(item.path));
              const Icon = item.icon;
              
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-2 text-xs sm:text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap",
                    isActive 
                      ? "bg-primary/10 text-primary shadow-sm" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="hidden sm:inline">{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-4">
          <GlobalSearch />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
