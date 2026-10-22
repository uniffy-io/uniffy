import { useRef, useState } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi } from "@core/auth/authApi";
import { useAuth } from "@core/providers/AuthContext";
import { userFacingError } from "@shared/lib/userFacingError";
import {
  describeCreateOrganizationError,
  type CreateOrganizationFailure,
} from "@features/auth/createOrganizationForm";
import {
  canCreateOrganization,
  toOrganizationSummaries,
  type OrganizationSummary,
} from "@features/auth/organizationSerializer";

export const MY_ORGANIZATIONS_QUERY_KEY = ["organizations", "mine"];

const LOST_ACCESS_MESSAGE = "You no longer have access to that organization.";
const SELECT_FAILED_MESSAGE = "Could not switch to that organization. Try again.";
const OPEN_CREATED_FAILED_MESSAGE =
  "Your organization was created but could not be opened. Try again.";

type OrganizationRef = Pick<OrganizationSummary, "id" | "slug">;

export function useMyOrganizations() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: MY_ORGANIZATIONS_QUERY_KEY,
    queryFn: authApi.listMyOrganizations,
    select: toOrganizationSummaries,
    enabled: isAuthenticated,
  });
}

/** Reads the same response as `useMyOrganizations`, so one request feeds both. */
export function useCanCreateOrganization(): boolean {
  const { isAuthenticated } = useAuth();
  const { data } = useQuery({
    queryKey: MY_ORGANIZATIONS_QUERY_KEY,
    queryFn: authApi.listMyOrganizations,
    select: canCreateOrganization,
    enabled: isAuthenticated,
  });
  return data ?? false;
}

/** `onSelected` runs only once the session holds a token for the chosen organization. */
export function useSelectOrganization(onSelected?: () => void) {
  const { selectOrganization } = useAuth();
  const { refetch } = useMyOrganizations();
  const [selectingOrganizationId, setSelectingOrganizationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const select = async ({ id, slug }: Pick<OrganizationSummary, "id" | "slug">) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSelectingOrganizationId(id);
    setError(null);
    try {
      // The id survives a slug rename made since the list loaded; the slug is the fallback.
      await selectOrganization(slug, id);
    } catch (err) {
      // A removed membership or a suspension surfaces as a failed switch, so the
      // refreshed list decides whether access is gone or the attempt just failed.
      const { data } = await refetch({ cancelRefetch: false });
      const target = data?.find((org) => org.id === id);
      const accessLost = data !== undefined && (!target || target.suspended);
      setError(accessLost ? LOST_ACCESS_MESSAGE : userFacingError(err, SELECT_FAILED_MESSAGE));
      setSelectingOrganizationId(null);
      return;
    } finally {
      inFlight.current = false;
    }
    onSelected?.();
  };

  return { select, selectingOrganizationId, error };
}

/**
 * Creates the organization and opens it. An organization that was created but failed to open
 * is remembered, so trying again opens it instead of creating a second one.
 */
export function useCreateOrganization() {
  const { selectOrganization } = useAuth();
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<OrganizationRef | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<CreateOrganizationFailure | null>(null);
  const inFlight = useRef(false);

  const createOrganization = async (input: {
    name: string;
    slug?: string;
  }): Promise<OrganizationRef | null> => {
    try {
      const { organization } = await authApi.createOrganization(input);
      void queryClient.invalidateQueries({ queryKey: MY_ORGANIZATIONS_QUERY_KEY });
      const info = organization?.organization;
      if (!info) throw new Error("The created organization is missing from the response");
      const ref = { id: info.id, slug: info.slug };
      setCreated(ref);
      return ref;
    } catch (err) {
      // A refusal means the policy changed since the list loaded; the refreshed list hides
      // the way in.
      if (err instanceof ConnectError && err.code === Code.PermissionDenied) {
        void queryClient.invalidateQueries({ queryKey: MY_ORGANIZATIONS_QUERY_KEY });
      }
      setFailure(describeCreateOrganizationError(err));
      return null;
    }
  };

  const submit = async (input: { name: string; slug?: string }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setFailure(null);
    try {
      const target = created ?? (await createOrganization(input));
      if (!target) return;
      try {
        await selectOrganization(target.slug, target.id);
      } catch (err) {
        setFailure({ field: null, message: userFacingError(err, OPEN_CREATED_FAILED_MESSAGE) });
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return { submit, submitting, failure, created: created !== null };
}
