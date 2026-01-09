import { AppHeader } from '@/components/layout/AppHeader';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <AppHeader />
      <main className="container mx-auto py-6 px-4">
        {children}
      </main>
    </div>
  );
}
