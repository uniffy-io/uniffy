import { useCallback, useState } from "react";
import { Alert } from "react-native";
import type { ListMyOrganizationsResponse } from "@uniffy/proto/organizations/v1/organizations_pb";
import { queryClient } from "@core/api/queryClient";
import { authApi } from "@core/auth/authApi";
import { useAuth } from "@core/providers/AuthContext";
import {
  toOrganizationSummaries,
  type OrganizationSummary,
} from "@features/auth/organizationSerializer";
import { MY_ORGANIZATIONS_QUERY_KEY } from "@features/auth/useMyOrganizations";
import { userFacingError } from "@shared/lib/userFacingError";

const SWITCH_FAILED_MESSAGE = "Could not switch to that organization. Try again.";
// Names are a courtesy. Offline, the prompt goes out without them rather than waiting on a request.
const ORGANIZATION_NAMES_WAIT_MS = 3_000;

type SignOutChoice = { kind: "cancel" } | { kind: "discard" } | { kind: "switch" };

/** The organizations sign-out names, or null when the list cannot be loaded in time. */
async function memberOrganizations(): Promise<OrganizationSummary[] | null> {
  const cached = queryClient.getQueryData<ListMyOrganizationsResponse>(MY_ORGANIZATIONS_QUERY_KEY);
  if (cached) return toOrganizationSummaries(cached);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fetched = queryClient
    .fetchQuery({
      queryKey: MY_ORGANIZATIONS_QUERY_KEY,
      queryFn: authApi.listMyOrganizations,
      retry: false,
      // A paused query would hold the prompt until the device is back online.
      networkMode: "always",
    })
    .then(toOrganizationSummaries, () => null);
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ORGANIZATION_NAMES_WAIT_MS);
  });
  return Promise.race([fetched, late]).finally(() => clearTimeout(timer));
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Names where the edits wait, so the user can open that organization and let them save instead
 * of deleting them. An organization the user no longer belongs to cannot be named or opened.
 */
function describeUnsynced(
  organizationIds: readonly string[],
  organizations: OrganizationSummary[] | null,
  currentOrganizationId: string | null,
): { message: string; switchTarget: OrganizationSummary | null } {
  const generic = "Some edits on this device are not saved yet. Signing out deletes them.";
  if (!organizationIds.length || !organizations) return { message: generic, switchTarget: null };
  const known = organizations.filter((org) => organizationIds.includes(org.id));
  const unknown = organizationIds.length - known.length;
  const names = known.map((org) => org.name);
  if (unknown === 1) names.push("an organization you no longer belong to");
  else if (unknown > 1) names.push(`${unknown} organizations you no longer belong to`);
  const switchTarget =
    known.find((org) => org.id !== currentOrganizationId && !org.suspended) ?? null;
  const advice = switchTarget
    ? `Open ${switchTarget.name} to finish saving them, or sign out to delete them.`
    : "Signing out deletes them.";
  return { message: `Edits in ${joinNames(names)} are not saved yet. ${advice}`, switchTarget };
}

function confirmDiscard(message: string, switchLabel: string | null): Promise<SignOutChoice> {
  return new Promise((resolve) =>
    Alert.alert(
      "Unsaved edits",
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve({ kind: "cancel" }) },
        ...(switchLabel
          ? [{ text: switchLabel, onPress: () => resolve({ kind: "switch" as const }) }]
          : []),
        {
          text: "Discard and sign out",
          style: "destructive" as const,
          onPress: () => resolve({ kind: "discard" }),
        },
      ],
      { cancelable: true, onDismiss: () => resolve({ kind: "cancel" }) },
    ),
  );
}

type Auth = ReturnType<typeof useAuth>;

async function signOutWithPrompt(
  logout: Auth["logout"],
  organizationId: Auth["organizationId"],
  selectOrganization: Auth["selectOrganization"],
): Promise<boolean> {
  const result = await logout();
  if (result.status === "signed_out") return true;
  const organizations = result.organizationIds.length ? await memberOrganizations() : null;
  const { message, switchTarget } = describeUnsynced(
    result.organizationIds,
    organizations,
    organizationId,
  );
  const choice = await confirmDiscard(
    message,
    switchTarget ? `Switch to ${switchTarget.name}` : null,
  );
  if (choice.kind === "switch" && switchTarget) {
    await selectOrganization(switchTarget.slug, switchTarget.id).catch((err: unknown) =>
      Alert.alert("Switch failed", userFacingError(err, SWITCH_FAILED_MESSAGE)),
    );
    return false;
  }
  if (choice.kind !== "discard") return false;
  return (await logout({ discardUnsynced: true })).status === "signed_out";
}

/** Signs out, asking first when edits only this device holds would be deleted. The prompt names
 * the organizations that hold them and offers to switch to one, where they finish saving.
 * Resolves true once signed out. Checking can wait a few seconds for pending edits to save. */
export function useSignOut(): { signOut: () => Promise<boolean>; signingOut: boolean } {
  const { logout, organizationId, selectOrganization } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const signOut = useCallback(() => {
    setSigningOut(true);
    return signOutWithPrompt(logout, organizationId, selectOrganization).finally(() =>
      setSigningOut(false),
    );
  }, [logout, organizationId, selectOrganization]);
  return { signOut, signingOut };
}
