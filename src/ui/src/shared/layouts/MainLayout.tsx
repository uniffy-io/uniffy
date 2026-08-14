import { AppHeader } from "@/components/layout/AppHeader";
import { PushNotificationBanner } from "@/features/notifications/components/PushNotificationBanner";

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="flex flex-col h-dvh bg-background text-foreground font-sans antialiased overflow-hidden">
      <PushNotificationBanner />
      <AppHeader />
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto py-4 px-3 md:py-6 md:px-4">{children}</div>
      </main>
    </div>
  );
}
