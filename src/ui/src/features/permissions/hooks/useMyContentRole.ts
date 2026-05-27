import { useAppSelector } from '@/app/hooks';
import { ContentRole, AccessMode } from '@uniffy/proto/common/v1/common_pb';

/** Prefer `explicitRole` from the domain slice; fall back to policy resolution. */
export function useMyContentRole(
    contentType: number,
    contentId: string,
    explicitRole?: ContentRole | number | null,
): ContentRole | null {
    const currentUserId = useAppSelector((s) => s.auth.user?.id ?? '');
    const policy = useAppSelector(
        (s) => s.permissions.byContent[`${contentType}:${contentId}`]?.policy,
    );

    // UNSPECIFIED means "not set" - fall through rather than denying access.
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
