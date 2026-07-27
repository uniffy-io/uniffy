import { useMemo, useState } from "react";
import { cn } from "@/shared/utils/cn";
import { roleCanManage } from "@/shared/utils/contentRoles";
import { MemoryScope } from "@uniffy/proto/agents/v1/memories_pb";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import {
    MemoryList,
    type MemoryScopeDescriptor,
} from "@/features/agents/components/memory/MemoryList";

type MemorySegment = "user" | "org";

const SEGMENTS: Array<{ key: MemorySegment; label: string }> = [
    { key: "user", label: "My memory" },
    { key: "org", label: "Org memory" },
];

export function MemoriesTab({ agent }: { agent: SerializedAgent }) {
    const [segment, setSegment] = useState<MemorySegment>("user");
    const canManageAgent = roleCanManage(agent.userRole);

    const descriptor = useMemo<MemoryScopeDescriptor>(
        () =>
            segment === "user"
                ? {
                      scope: MemoryScope.USER,
                      canCreate: true,
                      canPin: true,
                      canEdit: () => true,
                      canDelete: () => true,
                  }
                : {
                      scope: MemoryScope.ORG,
                      canCreate: canManageAgent,
                      canPin: canManageAgent,
                      canEdit: () => canManageAgent,
                      canDelete: () => canManageAgent,
                  },
        [segment, canManageAgent]
    );

    return (
        <div className="max-w-4xl mx-auto space-y-4">
            <div>
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
                    Agent Memories
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                    View and manage what this agent remembers
                </p>
            </div>

            <div className="flex items-center gap-0 border-b border-border">
                {SEGMENTS.map((s) => (
                    <button
                        key={s.key}
                        type="button"
                        onClick={() => setSegment(s.key)}
                        className={cn(
                            "px-4 py-2 text-sm -mb-px border-b-2 transition-colors cursor-pointer",
                            segment === s.key
                                ? "text-primary border-primary font-medium"
                                : "text-muted-foreground border-transparent hover:text-foreground"
                        )}
                        data-testid={`agent-memories-segment-${s.key}`}
                        data-active={segment === s.key ? "true" : "false"}
                    >
                        {s.label}
                    </button>
                ))}
            </div>

            <MemoryList
                key={segment}
                agentId={agent.id}
                agentName={agent.name}
                descriptor={descriptor}
            />
        </div>
    );
}
