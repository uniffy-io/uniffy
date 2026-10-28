import type { OrbitNode, OrbitScene, RingIndex } from "@/components/orbit/engine";
import { identityStops } from "@/config/theme/brandGradients";
import type { OrganizationSummary } from "@/features/auth/store/organizationsSlice";

const SUSPENDED: [string, string] = ["#6b7280", "#9ca3af"];
const RING_CAPACITY: [RingIndex, number][] = [
  [2, 6],
  [3, 10],
];

interface WelcomeSceneInput {
  organizations: OrganizationSummary[];
  currentOrganizationId: string | null;
  highlighted: string | null;
  launching: boolean;
}

/** Each organization orbits the signed-in user, painted with the same identity as its avatar tile. */
function organizationNodes(input: WelcomeSceneInput): OrbitNode[] {
  const nodes: OrbitNode[] = [];
  let index = 0;
  for (const [ring, capacity] of RING_CAPACITY) {
    const members = input.organizations.slice(index, index + capacity);
    index += capacity;
    members.forEach((organization, slot) => {
      const { start, end } = identityStops(organization.name || organization.slug);
      nodes.push({
        id: organization.id,
        label: `@${organization.slug}`,
        colors: organization.suspended ? SUSPENDED : [start, end],
        ring,
        // Offset the outer ring by half a slot so its labels fall between the inner ones.
        angle: (slot + (ring === 3 ? 0.5 : 0)) / members.length + 0.08,
        emphasis:
          organization.slug === input.highlighted ||
          (input.highlighted === null && organization.id === input.currentOrganizationId),
      });
    });
  }
  return nodes;
}

export function buildWelcomeScene(input: WelcomeSceneInput): OrbitScene {
  return {
    hubLabel: "You",
    nodes: organizationNodes(input),
    mesh: input.highlighted ? 0.12 : 0.28,
    converge: false,
    collapse: input.launching,
  };
}
