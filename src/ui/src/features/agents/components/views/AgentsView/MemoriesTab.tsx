import { useMemo, useState } from "react";
import { cn } from "@/shared/utils/cn";
import { roleCanManage } from "@/shared/utils/contentRoles";
import { MemoryScope } from "@uniffy/proto/agents/v1/memories_pb";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import {
  MemoryList,
  type MemoryScopeDescriptor,
} from "@/features/agents/components/memory/MemoryList";

type Tier = "shared" | "agent";

const TIERS: { id: Tier; label: string; blurb: string }[] = [
  {
    id: "shared",
    label: "All agents",
    blurb: "Facts every agent in the organization should know.",
  },
  {
    id: "agent",
    label: "This agent",
    blurb: "Facts only this agent carries into its conversations.",
  },
];

/**
 * Organization memory in its two tiers. Personal memories belong to the member
 * who owns them, not to whoever manages the agent, so they are managed in
 * Settings > AI - a builder must not browse another member's entries from here.
 */
export function MemoriesTab({ agent }: { agent: SerializedAgent }) {
  const canManageAgent = roleCanManage(agent.userRole);
  const [tier, setTier] = useState<Tier>("shared");

  const descriptor = useMemo<MemoryScopeDescriptor>(
    () => ({
      scope: MemoryScope.ORG,
      agentId: tier === "agent" ? agent.id : undefined,
      canCreate: canManageAgent,
      canPin: canManageAgent,
      canEdit: () => canManageAgent,
      canDelete: () => canManageAgent,
    }),
    [tier, agent.id, canManageAgent],
  );

  const active = TIERS.find((t) => t.id === tier) ?? TIERS[0];

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
          Organization Memory
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {active.blurb} Members manage what agents remember about them personally in Settings &gt;
          AI.
        </p>
      </div>

      <div className="inline-flex rounded-md border border-border p-0.5">
        {TIERS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setTier(option.id)}
            data-testid={`memory-tier-${option.id}`}
            className={cn(
              "px-3 py-1.5 text-sm rounded transition-colors cursor-pointer",
              tier === option.id
                ? "bg-muted text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <MemoryList key={tier} agentName={agent.name} descriptor={descriptor} />
    </div>
  );
}
