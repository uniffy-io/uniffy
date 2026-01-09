import { Link, useLocation } from 'react-router-dom';
import { 
  DocumentTextIcon, 
  ChatBubbleLeftRightIcon, 
  FolderIcon, 
  CalendarIcon, 
  BookOpenIcon, 
  KeyIcon,
  Squares2X2Icon
} from '@heroicons/react/24/outline';
import { UserMenu } from './UserMenu';
import { cn } from '@/utils/cn';

const navItems = [
  { name: 'Dashboard', path: '/', icon: Squares2X2Icon },
  { name: 'Notes', path: '/notes', icon: DocumentTextIcon },
  { name: 'Files', path: '/files', icon: FolderIcon },
  { name: 'Chat', path: '/chat', icon: ChatBubbleLeftRightIcon },
  { name: 'Calendar', path: '/calendar', icon: CalendarIcon },
  { name: 'Library', path: '/library', icon: BookOpenIcon },
  { name: 'Vault', path: '/vault', icon: KeyIcon },
];

export function AppHeader() {
  const location = useLocation();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center mx-auto px-4 justify-between">
        <div className="flex items-center gap-6 md:gap-8">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold shadow-sm">
              U
            </div>
            <span className="hidden font-bold sm:inline-block text-xl tracking-tight">UWOS</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path || 
                               (item.path !== '/' && location.pathname.startsWith(item.path));
              const Icon = item.icon;
              
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-all duration-200",
                    isActive 
                      ? "bg-primary/10 text-primary shadow-sm" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-4">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
