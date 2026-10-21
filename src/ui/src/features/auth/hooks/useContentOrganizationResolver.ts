import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  resolveContentOrganization,
  type ContentOrganization,
} from "@/features/auth/store/organizationsThunks";
import { isValidUrn } from "@/shared/utils/urn";

export type ContentOrganizationStatus = "idle" | "resolving" | "done";

export interface ContentOrganizationLookup {
  /** Another organization of the user that holds the item; null when there is none to offer. */
  match: ContentOrganization | null;
  status: ContentOrganizationStatus;
}

interface Settled {
  key: string;
  organization: ContentOrganization | null;
}

const IDLE: ContentOrganizationLookup = { match: null, status: "idle" };
const RESOLVING: ContentOrganizationLookup = { match: null, status: "resolving" };
const UNMATCHED: ContentOrganizationLookup = { match: null, status: "done" };

/**
 * Asks once per item and tab organization, only after the page's own load failed, which of the
 * user's other organizations holds the item.
 */
export function useContentOrganizationResolver(
  urn: string | null,
  failed: boolean,
): ContentOrganizationLookup {
  const dispatch = useAppDispatch();
  const currentOrganizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const [settled, setSettled] = useState<Settled | null>(null);
  const requestedKey = useRef<string | null>(null);
  const key = failed && urn && isValidUrn(urn) ? `${currentOrganizationId ?? ""}|${urn}` : null;

  useEffect(() => {
    if (!key || !urn || requestedKey.current === key) return;
    requestedKey.current = key;
    dispatch(resolveContentOrganization(urn))
      .unwrap()
      .then(
        (found) => setSettled({ key, organization: found?.organization ?? null }),
        // The error went through the global toast; the page falls back as if nothing matched.
        () => setSettled({ key, organization: null }),
      );
  }, [dispatch, key, urn]);

  if (!key) return IDLE;
  if (settled?.key !== key) return RESOLVING;
  const organization = settled.organization;
  // The tab's own organization holding it means the item is genuinely gone or out of reach here.
  if (!organization || organization.id === currentOrganizationId) return UNMATCHED;
  return { match: organization, status: "done" };
}
