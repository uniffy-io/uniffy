import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { ORGANIZATION_LOST_EVENT } from "@/config/api";
import { clearSessionCaches } from "@/features/auth/hooks/useSignOut";
import { useRealtimeDrain } from "@/features/realtime/hooks/useRealtimeDrain";
import { fetchEffectiveSettings } from "@/features/settings";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector((state) => state.auth?.isAuthenticated ?? false);
  const currentOrganizationId = useAppSelector((state) => state.auth?.currentOrganizationId);
  const isRehydrating = useAppSelector((state) => state.auth?.isRehydrating ?? false);
  const refreshToken = useAppSelector((state) => state.auth?.refreshToken);
  const initialized = useAppSelector((state) => state.settings?.initialized ?? false);
  const location = useLocation();
  // Stranded offline edits replay from here, whichever page the user lands on.
  useRealtimeDrain();

  useEffect(() => {
    if (isAuthenticated && currentOrganizationId && !initialized) {
      dispatch(fetchEffectiveSettings(undefined));
    }
  }, [dispatch, isAuthenticated, currentOrganizationId, initialized]);

  // A refresh that comes back without the tab's organization means the grant is gone; the caches
  // outside Redux still hold that organization's content.
  useEffect(() => {
    const handleLost = () => {
      clearSessionCaches(dispatch);
      toast.warning("Your access to that organization ended.");
    };
    window.addEventListener(ORGANIZATION_LOST_EVENT, handleLost);
    return () => window.removeEventListener(ORGANIZATION_LOST_EVENT, handleLost);
  }, [dispatch]);

  // Wait for rehydration before redirecting; otherwise an in-flight token refresh would race to /auth.
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

  if (!currentOrganizationId) {
    return <Navigate to="/select-org" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
