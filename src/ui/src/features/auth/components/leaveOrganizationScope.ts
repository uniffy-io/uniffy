import type { NavigateFunction } from "react-router-dom";
import type { AppDispatch } from "@/app/store";
import {
  ORGANIZATION_LOST_EVENT,
  refreshAccessToken,
  takePendingOrganizationLost,
} from "@/config/api";
import { clearSessionCaches } from "@/features/auth/hooks/useSignOut";
import { resetOrganizationScope } from "@/features/auth/store/authActions";
import { purgeCleanSnapshots } from "@/features/realtime/persistence/encryptedYjsPersistence";

export const WELCOME_PATH = "/welcome";

interface LeftOrganization {
  organizationId: string;
  userId: string;
  navigate: NavigateFunction;
}

/**
 * Moves this tab out of an organization the user just left or deleted, running the cleanup the
 * lost-grant listeners would run. The loss the refresh announces is taken the moment it fires,
 * before a redirect can mount ProtectedRoute and replay it as "Your access to that organization
 * ended."
 */
export async function leaveCurrentOrganizationScope(
  dispatch: AppDispatch,
  { organizationId, userId, navigate }: LeftOrganization,
): Promise<void> {
  void clearSessionCaches(dispatch, {
    reason: "lost-grant",
    organizationId,
    userId,
    preserveCurrentScope: false,
  });
  void purgeCleanSnapshots(userId, organizationId).catch((error: unknown) => {
    console.warn("[auth] left organization cleanup failed", error);
  });
  dispatch(resetOrganizationScope());

  const takeAnnouncedLoss = () => {
    takePendingOrganizationLost(userId);
  };
  window.addEventListener(ORGANIZATION_LOST_EVENT, takeAnnouncedLoss);
  try {
    // The server dropped the grant, so this comes back org-less and the tab leaves the org.
    await refreshAccessToken();
  } catch (error) {
    console.warn("[auth] refresh after leaving an organization failed", error);
  } finally {
    window.removeEventListener(ORGANIZATION_LOST_EVENT, takeAnnouncedLoss);
  }
  navigate(WELCOME_PATH, { replace: true });
}
