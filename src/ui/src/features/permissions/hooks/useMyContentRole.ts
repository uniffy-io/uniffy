import { useAppSelector } from '@/app/hooks';
import { ContentRole, AccessMode } from '@uniffy/proto/common/v1/common_pb';

/**
 * Returns the current user's effective role on a piece of content.
 *
 * Preferred usage: callers read the `userRole` field from their domain slice
 * row directly and pass it as `explicitRole`. For content without a domain
 * slice entry, falls back to deriving from the permissions slice policy
 * (fetched by `useContentMembers`).
 */
export function useMyContentRole(
    contentType: number,
    contentId: string,
    explicitRole?: ContentRole | number | null,
): ContentRole | null {
    const currentUserId = useAppSelector((s) => s.auth.user?.id ?? '');
    const policy = useAppSelector(
        (s) => s.permissions.byContent[`${contentType}:${contentId}`]?.policy,
    );

    // Treat UNSPECIFIED (0) as "not set" so a stale or in-flight proto value
    // falls through to the policy-based resolution below instead of forcing
    // a no-access verdict on the caller.
    if (
        explicitRole !== undefined
        && explicitRole !== null
        && explicitRole !== ContentRole.UNSPECIFIED
    ) {
        return explicitRole as ContentRole;
    }

    if (policy) {
        if (policy.ownerId === currentUserId) return ContentRole.OWNER;
        if (policy.accessMode === AccessMode.OPEN_TO_ORG && policy.baselineRole != null) {
            return policy.baselineRole as ContentRole;
        }
    }

    return null;
}
