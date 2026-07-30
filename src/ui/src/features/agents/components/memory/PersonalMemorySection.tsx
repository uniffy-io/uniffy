import { useMemo } from 'react';
import { MemoryScope } from '@uniffy/proto/agents/v1/memories_pb';
import {
    MemoryList,
    type MemoryScopeDescriptor,
} from '@/features/agents/components/memory/MemoryList';

/**
 * One personal store per member, shared by every agent they talk to. It lives
 * here rather than in the builder because these entries are the member's, not
 * the agent manager's.
 */
export function PersonalMemorySection() {
    // A member owns every personal entry, so the permission questions the
    // builder panel has to answer do not arise here.
    const descriptor = useMemo<MemoryScopeDescriptor>(
        () => ({
            scope: MemoryScope.USER,
            canCreate: true,
            canPin: true,
            canEdit: () => true,
            canDelete: () => true,
        }),
        [],
    );

    return <MemoryList descriptor={descriptor} />;
}
