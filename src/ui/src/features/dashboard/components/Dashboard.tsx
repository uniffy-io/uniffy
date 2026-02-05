/**
 * Dashboard - Main dashboard/home page component
 *
 * Unified command center showing key metrics, recent activity,
 * and quick actions across all content domains.
 */

import { useAppSelector } from '@/app/hooks';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { QuickStatsWidget } from '@/features/dashboard/components/widgets/QuickStatsWidget';
import { RecentActivityWidget } from '@/features/dashboard/components/widgets/RecentActivityWidget';
import { QuickActionsWidget } from '@/features/dashboard/components/widgets/QuickActionsWidget';
import { UpcomingEventsWidget } from '@/features/dashboard/components/widgets/UpcomingEventsWidget';
import { BookmarkedItemsWidget } from '@/features/dashboard/components/widgets/BookmarkedItemsWidget';

export function Dashboard() {
  // Home/dashboard page - shows just "Uniffy" (no suffix)
  useDocumentTitle();

  const { user } = useAppSelector((state) => state.auth);

  // Get time-based greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const displayName = user?.fullName || user?.username || 'there';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {getGreeting()}, {displayName}
        </h1>
        <p className="text-muted-foreground">
          Here's what's happening in your workspace
        </p>
      </div>

      {/* Quick Stats Row */}
      <QuickStatsWidget />

      {/* Main Content Row */}
      <div className="grid gap-4 md:grid-cols-4">
        <RecentActivityWidget />
        <QuickActionsWidget />
      </div>

      {/* Bottom Row */}
      <div className="grid gap-4 md:grid-cols-4">
        <UpcomingEventsWidget />
        <BookmarkedItemsWidget />
      </div>
    </div>
  );
}
