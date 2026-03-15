import { AppHeader } from '@/components/layout/AppHeader';
import { PushNotificationBanner } from '@/features/notifications/components/PushNotificationBanner';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <PushNotificationBanner />
      <AppHeader />
      <main className="container mx-auto py-4 px-3 md:py-6 md:px-4">
        {children}
      </main>
    </div>
  );
}
