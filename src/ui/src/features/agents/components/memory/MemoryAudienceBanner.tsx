import { Buildings, Hash, LockSimple, UsersThree } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { MemoryScope } from '@uniffy/proto/agents/v1/memories_pb';

function audienceCopy(scope: MemoryScope, agentName: string, subjectLabel?: string): string {
    switch (scope) {
        case MemoryScope.ORG:
            return `Visible to everyone in your organization. In context for every conversation with ${agentName}. Managed by agent managers.`;
        case MemoryScope.CHANNEL:
            return `Visible to all members of ${subjectLabel ? `#${subjectLabel}` : 'this channel'}. Saved by ${agentName} during conversations here.`;
        case MemoryScope.SESSION:
            return 'Visible to participants of this session.';
        default:
            return `Only you can see these. Used in your private chats with ${agentName}, and in shared spaces only when sharing is on.`;
    }
}

const SCOPE_ICONS: Partial<Record<MemoryScope, Icon>> = {
    [MemoryScope.ORG]: Buildings,
    [MemoryScope.CHANNEL]: Hash,
    [MemoryScope.SESSION]: UsersThree,
};

export function MemoryAudienceBanner({
    scope,
    agentName,
    subjectLabel,
}: {
    scope: MemoryScope;
    agentName: string;
    subjectLabel?: string;
}) {
    const ScopeIcon = SCOPE_ICONS[scope] ?? LockSimple;

    return (
        <div
            className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
            data-testid="memory-audience-banner"
        >
            <ScopeIcon size={14} className="text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
                {audienceCopy(scope, agentName, subjectLabel)}
            </p>
        </div>
    );
}
