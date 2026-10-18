import { useAppSelector } from "@/app/hooks";
import { ContentRole, AccessMode } from "@uniffy/proto/common/v1/common_pb";
import type { ContentAccessPolicy } from "@/features/permissions/store/permissionsSlice";

/**
 * Prefer `explicitRole` from the domain slice; fall back to policy resolution.
 * An explicit OWNER is dropped once the policy names someone else as owner:
 * the domain slice still holds it right after the viewer transfers the item away.
 */
export function resolveMyContentRole(
  explicitRole: ContentRole | number | null | undefined,
  policy: ContentAccessPolicy | null | undefined,
  currentUserId: string,
): ContentRole | null {
  // UNSPECIFIED means "not set" - fall through rather than denying access.
  const hasExplicit =
    explicitRole !== undefined && explicitRole !== null && explicitRole !== ContentRole.UNSPECIFIED;
  const ownershipMoved =
    explicitRole === ContentRole.OWNER && !!policy && policy.ownerId !== currentUserId;
  if (hasExplicit && !ownershipMoved) {
    return explicitRole as ContentRole;
  }

  if (policy) {
    // Backend-resolved effective role is authoritative (group-resolved,
    // BLOCKED-aware). The owner / baseline branches below are a fallback
    // for responses that predate the field.
    if (policy.callerRole != null && policy.callerRole !== ContentRole.UNSPECIFIED) {
      return policy.callerRole as ContentRole;
    }
    if (policy.ownerId === currentUserId) return ContentRole.OWNER;
    if (policy.accessMode === AccessMode.OPEN_TO_ORG && policy.baselineRole != null) {
      return policy.baselineRole as ContentRole;
    }
  }

  return null;
}

export function useMyContentRole(
  contentType: number,
  contentId: string,
  explicitRole?: ContentRole | number | null,
): ContentRole | null {
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? "");
  const policy = useAppSelector(
    (s) => s.permissions.byContent[`${contentType}:${contentId}`]?.policy,
  );
  return resolveMyContentRole(explicitRole, policy, currentUserId);
}
