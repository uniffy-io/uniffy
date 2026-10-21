import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authApi } from "@core/auth/authApi";
import { useAuth } from "@core/providers/AuthContext";
import { userFacingError } from "@shared/lib/userFacingError";
import { toOrganizationSummaries } from "@features/auth/organizationSerializer";

const LOST_ACCESS_MESSAGE = "You no longer have access to that organization.";
const SELECT_FAILED_MESSAGE = "Could not switch to that organization. Try again.";

export function useMyOrganizations() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ["organizations", "mine"],
    queryFn: authApi.listMyOrganizations,
    select: toOrganizationSummaries,
    enabled: isAuthenticated,
  });
}

/** `onSelected` runs only once the session holds a token for the chosen organization. */
export function useSelectOrganization(onSelected?: () => void) {
  const { selectOrganization } = useAuth();
  const { refetch } = useMyOrganizations();
  const [selectingSlug, setSelectingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const select = async (slug: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSelectingSlug(slug);
    setError(null);
    try {
      await selectOrganization(slug);
    } catch (err) {
      // A removed membership or a suspension surfaces as a failed switch, so the
      // refreshed list decides whether access is gone or the attempt just failed.
      const { data } = await refetch({ cancelRefetch: false });
      const target = data?.find((org) => org.slug === slug);
      const accessLost = data !== undefined && (!target || target.suspended);
      setError(accessLost ? LOST_ACCESS_MESSAGE : userFacingError(err, SELECT_FAILED_MESSAGE));
      setSelectingSlug(null);
      return;
    } finally {
      inFlight.current = false;
    }
    onSelected?.();
  };

  return { select, selectingSlug, error };
}
