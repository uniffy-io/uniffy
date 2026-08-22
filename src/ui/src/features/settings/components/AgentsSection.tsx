import { Brain, ChartBar } from "@phosphor-icons/react";
import { UsageView } from "@/features/agents/components/views/UsageView";
import { MemorySharingToggle } from "@/features/agents/components/memory/MemorySharingToggle";
import { PersonalMemorySection } from "@/features/agents/components/memory/PersonalMemorySection";

export function AgentsSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Agents</h1>
        <p className="text-muted-foreground">
          Your own agent usage and personal memory preferences. Organization-wide keys, budgets, and
          defaults live under Admin.
        </p>
      </div>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Brain size={18} weight="duotone" className="text-primary" />
          <h2 className="text-base font-semibold">Agent memory</h2>
        </div>
        <MemorySharingToggle />
        <PersonalMemorySection />
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ChartBar size={18} weight="duotone" className="text-primary" />
          <h2 className="text-base font-semibold">Your usage</h2>
        </div>
        <UsageView />
      </section>
    </div>
  );
}
