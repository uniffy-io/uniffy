import type { ContentRole } from "@uniffy/proto/common/v1/common_pb";
import type { RealtimeStatus } from "@/features/realtime/protocol";
import { roleCanEdit, roleCanManage } from "@/shared/utils/contentRoles";

const READ_ONLY_STATUSES: ReadonlySet<RealtimeStatus> = new Set([
  "permission_lost",
  "access_lost",
  "update_rejected",
  "token_revoked",
]);

/** A lost note, deleted or no longer visible, stays on screen as last shown and offers nothing
 * that changes it, whatever role it last carried. A role still loading allows editing; the server
 * decides. */
export function noteAffordances(
  role: ContentRole | null,
  lost: boolean,
  status: RealtimeStatus,
): { canEdit: boolean; canShare: boolean } {
  if (lost) return { canEdit: false, canShare: false };
  return {
    canEdit: (role === null || roleCanEdit(role)) && !READ_ONLY_STATUSES.has(status),
    canShare: roleCanManage(role),
  };
}
