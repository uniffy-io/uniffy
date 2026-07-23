import { useEffect, useMemo, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { roleCanManage } from "@/shared/utils/contentRoles";
import { MemoryScope } from "@uniffy/proto/agents/v1/memories_pb";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import { selectMemorySharing } from "@/features/agents/store/agentMemoriesSlice";
import {
    fetchMemorySharing,
    updateMemorySharing,
} from "@/features/agents/store/agentMemoriesThunks";
import {
    MemoryList,
    type MemoryScopeDescriptor,
} from "@/features/agents/components/memory/MemoryList";

function MemorySharingToggle() {
    const dispatch = useAppDispatch();
    const sharing = useAppSelector(selectMemorySharing);

    useEffect(() => {
        if (!sharing.loaded) {
            dispatch(fetchMemorySharing());
        }
    }, [dispatch, sharing.loaded]);

    return (
        <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-card px-3 py-2.5">
            <div className="min-w-0">
                <p className="text-sm text-foreground">
                    Use my personal memory in shared spaces
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                    {sharing.orgAllows
                        ? "When on, agents you trigger in channels and shared sessions can read these memories. Replies others see may draw on them. Agents still never save personal memory from shared spaces."
                        : "Disabled by your organization."}
                </p>
            </div>
            <ToggleSwitch
                size="sm"
                enabled={sharing.useInSharedSpaces}
                disabled={!sharing.loaded || !sharing.orgAllows}
                onChange={(enabled) =>
                    dispatch(updateMemorySharing({ useInSharedSpaces: enabled }))
                }
            />
        </div>
    );
}

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
        <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h3 className="font-medium text-foreground">Agent Memories</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        View and manage what this agent remembers
                    </p>
                </div>
                <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5 shrink-0">
                    {SEGMENTS.map((s) => (
                        <button
                            key={s.key}
                            type="button"
                            onClick={() => setSegment(s.key)}
                            className={cn(
                                "px-3 py-1.5 rounded-md text-sm transition-all cursor-pointer",
                                segment === s.key
                                    ? "bg-card text-foreground shadow-sm font-medium"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                            data-testid={`agent-memories-segment-${s.key}`}
                            data-active={segment === s.key ? "true" : "false"}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>
            </div>

            {segment === "user" && <MemorySharingToggle />}

            <MemoryList
                key={segment}
                agentId={agent.id}
                agentName={agent.name}
                descriptor={descriptor}
            />
        </div>
    );
}
