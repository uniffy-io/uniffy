import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function SettingsPage() {
  useDocumentTitle('System Settings');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">System Settings</h1>
      </div>

      <div className="border rounded-lg p-6 bg-card text-card-foreground shadow-sm">
        <h3 className="text-lg font-medium mb-2">General Configuration</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Global system settings and configurations.
        </p>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded bg-background/50">
            <div>
              <div className="font-medium">Maintenance Mode</div>
              <div className="text-xs text-muted-foreground">Prevent non-admin users from logging in</div>
            </div>
            <div className="relative inline-flex h-6 w-11 items-center rounded-full bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <span className="translate-x-1 inline-block h-4 w-4 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out" />
            </div>
          </div>
          
          <div className="flex items-center justify-between p-4 border rounded bg-background/50">
            <div>
              <div className="font-medium">Public Registration</div>
              <div className="text-xs text-muted-foreground">Allow new users to sign up</div>
            </div>
            <div className="relative inline-flex h-6 w-11 items-center rounded-full bg-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <span className="translate-x-6 inline-block h-4 w-4 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
