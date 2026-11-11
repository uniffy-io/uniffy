import { AgentAssignmentPolicySection } from "@/features/admin/components/projects/AgentAssignmentPolicySection";
import { TimePolicySection } from "@/features/admin/components/projects/TimePolicySection";

export function ProjectsAdminPage() {
  return (
    <>
      <TimePolicySection />
      <AgentAssignmentPolicySection />
    </>
  );
}
