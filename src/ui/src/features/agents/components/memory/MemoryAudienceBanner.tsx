import { Buildings, Hash, LockSimple, Robot, UsersThree } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { MemoryScope } from "@uniffy/proto/agents/v1/memories_pb";
import type { MemoryScopeDescriptor } from "@/features/agents/components/memory/MemoryList";

function audienceCopy(
  descriptor: MemoryScopeDescriptor,
  agentName?: string,
  subjectLabel?: string,
): string {
  switch (descriptor.scope) {
    case MemoryScope.ORG:
      return descriptor.agentId
        ? `Visible to everyone in your organization, used only by ${agentName || "this agent"}. Managed by agent managers.`
        : "Visible to everyone in your organization and in context for every agent. Managed by agent managers.";
    case MemoryScope.CHANNEL:
      return `Visible to all members of ${subjectLabel ? `#${subjectLabel}` : "this channel"}, and to every agent working here.`;
    case MemoryScope.SESSION:
      return "Visible to participants of this session, and to every agent in it.";
    default:
      return "Only you can see these, and every agent you chat with uses them. Shared spaces see them only when sharing is on.";
  }
}

const SCOPE_ICONS: Partial<Record<MemoryScope, Icon>> = {
  [MemoryScope.ORG]: Buildings,
  [MemoryScope.CHANNEL]: Hash,
  [MemoryScope.SESSION]: UsersThree,
};

export function MemoryAudienceBanner({
  descriptor,
  agentName,
  subjectLabel,
}: {
  descriptor: MemoryScopeDescriptor;
  agentName?: string;
  subjectLabel?: string;
}) {
  const ScopeIcon = descriptor.agentId ? Robot : (SCOPE_ICONS[descriptor.scope] ?? LockSimple);

  return (
    <div
      className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
      data-testid="memory-audience-banner"
    >
      <ScopeIcon size={14} className="text-muted-foreground shrink-0 mt-0.5" />
      <p className="text-xs text-muted-foreground">
        {audienceCopy(descriptor, agentName, subjectLabel)}
      </p>
    </div>
  );
}
