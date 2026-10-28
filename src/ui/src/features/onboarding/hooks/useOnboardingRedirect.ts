import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { selectOnboardingFor } from "@/features/onboarding/store/onboardingSlice";
import { fetchOnboarding } from "@/features/onboarding/store/onboardingThunks";

export const ONBOARDING_PATH = "/onboarding";

/** True while the tab's owner still has the entry flow to finish and is somewhere else. */
export function useOnboardingRedirect(pathname: string): boolean {
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const isOwner = useAppSelector((state) => state.auth.currentOrganizationRole === "OWNER");
  const onboarding = useAppSelector((state) => selectOnboardingFor(state, organizationId));

  useEffect(() => {
    if (isAuthenticated && organizationId && isOwner)
      void dispatch(fetchOnboarding(organizationId));
  }, [dispatch, isAuthenticated, organizationId, isOwner]);

  return isOwner && onboarding?.pending === true && pathname !== ONBOARDING_PATH;
}
