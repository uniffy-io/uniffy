import { realtimeMultiplexer } from "@/features/realtime/multiplexer";
import { hasPendingDocs, listPendingDocs } from "@/features/realtime/pendingDocs";
import { listStoredPendingOrganizations } from "@/features/realtime/persistence/encryptedYjsPersistence";

/** Own edits no PostgreSQL checkpoint covers yet: live docs, or docs waiting for the drain. With
 * `organizationId`, only that organization's, such as before this tab switches away from it. */
export function hasUnsyncedEdits(userId: string | null, organizationId?: string): boolean {
  return (
    realtimeMultiplexer.hasCheckpointPending(organizationId) ||
    (userId !== null && hasPendingDocs(userId, organizationId))
  );
}

/** Every organization holding this user's edits no checkpoint covers: this tab's live docs, the
 * drain registry, and stored pending or dirty rows, recovered drafts included. */
export async function listPendingOrganizations(userId: string): Promise<string[]> {
  const organizations = new Set(realtimeMultiplexer.checkpointPendingOrganizations());
  for (const entry of listPendingDocs())
    if (entry.userId === userId) organizations.add(entry.organizationId);
  for (const organizationId of await listStoredPendingOrganizations(userId))
    organizations.add(organizationId);
  return [...organizations];
}
