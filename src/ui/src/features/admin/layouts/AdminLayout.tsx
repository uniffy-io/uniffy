import { Outlet, Link, useLocation } from 'react-router-dom';
import { AppHeader } from '@/components/layout/AppHeader';
import { cn } from '@/utils/cn';

const navItems = [
  { name: 'Organizations', path: '/admin/organizations' },
  { name: 'Users', path: '/admin/users' },
  { name: 'Settings', path: '/admin/settings' },
];

export function AdminLayout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <AppHeader />
      <div className="container mx-auto py-6 px-4 flex flex-col md:flex-row gap-8">
        <aside className="w-full md:w-64 shrink-0">
          <nav className="flex flex-row md:flex-col space-x-1 md:space-x-0 md:space-y-1 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0">
            <div className="hidden md:block px-3 py-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              System Admin
            </div>
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap",
                  location.pathname.startsWith(item.path)
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {item.name}
              </Link>
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
