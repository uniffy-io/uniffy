import { Navigate, useLocation } from "react-router-dom";
import { useAppSelector } from "@/app/hooks";
import { useAdminAccess } from "@/features/admin/hooks/useAdminHooks";

interface AdminRouteProps {
  children: React.ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps) {
  const isAuthenticated = useAppSelector((state) => state.auth?.isAuthenticated ?? false);
  const isRehydrating = useAppSelector((state) => state.auth?.isRehydrating ?? false);
  const refreshToken = useAppSelector((state) => state.auth?.refreshToken);
  const location = useLocation();
  const { canAccessAdmin } = useAdminAccess();

  if (isRehydrating || (!isAuthenticated && refreshToken)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (!canAccessAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
