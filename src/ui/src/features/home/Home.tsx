import { useAppSelector } from '@/app/hooks';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export function Home() {
  useDocumentTitle('Home');
  const { user } = useAppSelector((state) => state.auth);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back, {user?.fullName || user?.username}. Here's an overview of your workspace.
        </p>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Quick Stats / Cards */}
        <div className="rounded-xl border border-border bg-card text-card-foreground shadow-sm p-6">
          <div className="flex flex-row items-center justify-between space-y-0 pb-2">
            <h3 className="tracking-tight text-sm font-medium">Notes</h3>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              className="h-4 w-4 text-muted-foreground"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" x2="8" y1="13" y2="13" />
              <line x1="16" x2="8" y1="17" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div className="text-2xl font-bold">0</div>
          <p className="text-xs text-muted-foreground">
            +0 from last week
          </p>
        </div>

        {/* Placeholder for other stats */}
        <div className="rounded-xl border border-border bg-card text-card-foreground shadow-sm p-6">
          <div className="flex flex-row items-center justify-between space-y-0 pb-2">
            <h3 className="tracking-tight text-sm font-medium">Messages</h3>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              className="h-4 w-4 text-muted-foreground"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div className="text-2xl font-bold">0</div>
          <p className="text-xs text-muted-foreground">
            +0 since last hour
          </p>
        </div>
      </div>
      
      {/* Recent Activity or Content */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <div className="col-span-4 rounded-xl border border-border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6">
            <h3 className="font-semibold leading-none tracking-tight">Recent Activity</h3>
            <p className="text-sm text-muted-foreground">
              Your recent actions across the workspace.
            </p>
          </div>
          <div className="p-6 pt-0">
            <div className="text-sm text-muted-foreground">No recent activity.</div>
          </div>
        </div>
        
        <div className="col-span-3 rounded-xl border border-border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6">
            <h3 className="font-semibold leading-none tracking-tight">Quick Links</h3>
            <p className="text-sm text-muted-foreground">
              Jump to your favorite tools.
            </p>
          </div>
          <div className="p-6 pt-0">
             <div className="text-sm text-muted-foreground">No quick links configured.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
