import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import {
  ORGANIZATION_LOST_EVENT,
  takePendingOrganizationLost,
  type OrganizationLostDetail,
} from "@/config/api";
import { clearSessionCaches } from "@/features/auth/hooks/useSignOut";
import {
  clearTabOrganization,
  readTabOrganization,
} from "@/features/auth/store/tabOrganizationStorage";
import { useRealtimeDrain } from "@/features/realtime/hooks/useRealtimeDrain";
import { fetchEffectiveSettings } from "@/features/settings";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector((state) => state.auth?.isAuthenticated ?? false);
  const currentOrganizationId = useAppSelector((state) => state.auth?.currentOrganizationId);
  const userId = useAppSelector((state) => state.auth?.user?.id ?? null);
  const isRehydrating = useAppSelector((state) => state.auth?.isRehydrating ?? false);
  const refreshToken = useAppSelector((state) => state.auth?.refreshToken);
  const initialized = useAppSelector((state) => state.settings?.initialized ?? false);
  const location = useLocation();
  // Stranded offline edits replay from here, whichever page the user lands on. Its lost-grant
  // listener registers before the one below, so a replayed loss reaches both.
  useRealtimeDrain();

  useEffect(() => {
    if (isAuthenticated && currentOrganizationId && !initialized) {
      dispatch(fetchEffectiveSettings(undefined));
    }
  }, [dispatch, isAuthenticated, currentOrganizationId, initialized]);

  // A refresh that comes back without the tab's organization means the grant is gone; the caches
  // outside Redux and the device stores of that organization still hold its content.
  useEffect(() => {
    if (!userId) return;
    const handleLost = (event: Event) => {
      takePendingOrganizationLost(userId);
      const lost = (event as CustomEvent<OrganizationLostDetail>).detail?.organizationId;
      if (lost && readTabOrganization(userId)?.id === lost) clearTabOrganization(userId);
      void clearSessionCaches(dispatch, {
        reason: "lost-grant",
        organizationId: lost,
        userId,
        preserveCurrentScope: Boolean(
          lost && currentOrganizationId && currentOrganizationId !== lost,
        ),
      });
      toast.warning("Your access to that organization ended.");
    };
    window.addEventListener(ORGANIZATION_LOST_EVENT, handleLost);
    // Device cleanup still belongs to the lost organization after this tab enters another one.
    const pending = takePendingOrganizationLost(userId);
    if (pending) {
      window.dispatchEvent(
        new CustomEvent<OrganizationLostDetail>(ORGANIZATION_LOST_EVENT, { detail: pending }),
      );
    }
    return () => window.removeEventListener(ORGANIZATION_LOST_EVENT, handleLost);
  }, [currentOrganizationId, dispatch, userId]);

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
