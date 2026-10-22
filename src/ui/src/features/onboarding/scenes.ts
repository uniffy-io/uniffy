import {
  BRAND_AXIS_END,
  BRAND_AXIS_START,
  identityStops,
  mixHex,
} from "@/config/theme/brandGradients";
import { getUrnTypeHexColor } from "@/config/theme/urnColors";
import type { OrbitNode, OrbitScene } from "@/components/orbit/engine";
import type { MentionDisplayMode } from "@/components/mention/mentionStateContext";
import type { SharingPreset } from "@/features/onboarding/sharing";
import { stepIndex, type OnboardingStepId } from "@/features/onboarding/steps";
import { UrnType } from "@/shared/utils/urnTypes";

export interface SceneInput {
  step: OnboardingStepId;
  organizationSlug: string;
  sharing: SharingPreset;
  agentConnected: boolean;
  invitees: string[];
  launching: boolean;
  /** On the mention step, expanded mentions show as bigger, bolder nodes. */
  mentionDisplay: MentionDisplayMode;
}

function typed(type: UrnType): [string, string] {
  const hex = getUrnTypeHexColor(type);
  return [hex, mixHex(hex, "#ffffff", 0.3)];
}

const YOU: OrbitNode = {
  id: "you",
  label: "You",
  colors: [BRAND_AXIS_START, BRAND_AXIS_END],
  ring: 1,
  angle: 0.62,
  glyph: "person",
};

const CONTENT: OrbitNode[] = [
  { id: "note", label: "@roadmap", colors: typed(UrnType.NOTE), ring: 2, angle: 0.05 },
  { id: "file", label: "@budget.xlsx", colors: typed(UrnType.FILE), ring: 3, angle: 0.14 },
  { id: "chat", label: "#general", colors: typed(UrnType.CHAT), ring: 2, angle: 0.3 },
  { id: "event", label: "@standup", colors: typed(UrnType.CALENDAR_EVENT), ring: 3, angle: 0.4 },
  { id: "project", label: "@q4-launch", colors: typed(UrnType.PROJECT), ring: 2, angle: 0.53 },
  { id: "task", label: "@fix-login", colors: typed(UrnType.TASK), ring: 3, angle: 0.67 },
  { id: "room", label: "@design-sync", colors: typed(UrnType.ROOM), ring: 2, angle: 0.8 },
  { id: "diagram", label: "@architecture", colors: typed(UrnType.NOTE), ring: 3, angle: 0.9 },
];

const MESH_FOR_SHARING: Record<SharingPreset, number> = { edit: 1, comment: 0.62, view: 0.3 };

function agentNode(connected: boolean): OrbitNode {
  return {
    id: "agent",
    label: "@NavigatorAgent",
    colors: typed(UrnType.AGENT),
    ring: 1,
    angle: 0.12,
    emphasis: connected,
  };
}

/** Invitees spread across the outer ring; their colors follow the avatar identity hash. */
function inviteeNodes(emails: string[]): OrbitNode[] {
  return emails.slice(0, 10).map((email, index, list) => {
    const handle = email.split("@")[0] || email;
    const { start, end } = identityStops(email);
    return {
      id: `invitee:${email}`,
      label: `@${handle}`,
      colors: [start, end],
      ring: 3,
      angle: 0.2 + (index / Math.max(list.length, 1)) * 0.95,
      glyph: "person",
    };
  });
}

/** The graph only grows: every step keeps what the steps before it added. */
export function buildScene(input: SceneInput): OrbitScene {
  const at = stepIndex(input.step);
  const reached = (step: OnboardingStepId) => at >= stepIndex(step);

  const nodes: OrbitNode[] = [YOU];
  if (reached("mentions")) {
    const expanded = input.step === "mentionDisplay" && input.mentionDisplay === "expanded";
    nodes.push(...CONTENT.map((node) => ({ ...node, emphasis: expanded })));
  }
  if (reached("agents")) nodes.push(agentNode(input.agentConnected));
  if (reached("team")) nodes.push(...inviteeNodes(input.invitees));

  let mesh = 0;
  if (input.step === "mentions" || input.step === "mentionDisplay") mesh = 0.85;
  else if (reached("sharing")) mesh = MESH_FOR_SHARING[input.sharing];

  return {
    hubLabel: `@${input.organizationSlug}`,
    nodes,
    mesh,
    converge: input.step === "launch",
    collapse: input.launching,
  };
}
