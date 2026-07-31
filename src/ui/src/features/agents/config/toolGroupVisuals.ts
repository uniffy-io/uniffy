import type { Icon } from "@phosphor-icons/react";
import {
    Brain,
    CalendarDots,
    CheckSquare,
    ClockCounterClockwise,
    Door,
    FolderSimple,
    Gear,
    GithubLogo,
    Image as ImageIcon,
    Kanban,
    Lightning,
    MagnifyingGlass,
    NotePencil,
    Users,
    Wrench,
} from "@phosphor-icons/react";
import { brandRampStops, type BrandStops } from "@/config/theme/brandGradients";

interface ToolGroupIdentity {
    icon: Icon;
    /**
     * Nouns dropped from a tool's display name so a pill reads as the bare verb:
     * "Search Notes" -> "Search". Matching is per word, case-insensitive.
     */
    nouns: string[];
}

export interface ToolGroupVisual extends ToolGroupIdentity {
    /** Wash, border and chip tint. */
    stops: BrandStops;
    /** Darkened stops, so a white icon on top stays legible near the pink end. */
    iconStops: BrandStops;
}

/**
 * Keyed by the `group` label the server sends with each tool. A group with no
 * entry here still renders, with the fallback icon - the server can ship a new
 * group before the frontend has art for it.
 */
const TOOL_GROUP_IDENTITIES: Record<string, ToolGroupIdentity> = {
    Notes: { icon: NotePencil, nouns: ["note", "notes"] },
    Files: { icon: FolderSimple, nouns: ["file", "files"] },
    Projects: { icon: Kanban, nouns: ["project", "projects"] },
    Tasks: { icon: CheckSquare, nouns: ["task", "tasks"] },
    Calendar: { icon: CalendarDots, nouns: ["event", "events"] },
    Rooms: { icon: Door, nouns: ["room", "rooms"] },
    Search: { icon: MagnifyingGlass, nouns: ["content"] },
    People: { icon: Users, nouns: ["member", "members", "user", "users"] },
    Memory: { icon: Brain, nouns: ["memory", "memories"] },
    Skills: { icon: Lightning, nouns: ["skill", "skills"] },
    Scheduling: { icon: ClockCounterClockwise, nouns: ["scheduled", "task", "tasks"] },
    System: { icon: Gear, nouns: [] },
    Images: { icon: ImageIcon, nouns: ["image", "images"] },
    GitHub: { icon: GithubLogo, nouns: [] },
};

const FALLBACK_IDENTITY: ToolGroupIdentity = { icon: Wrench, nouns: [] };

/**
 * Ramp order, set from the server's group order once the catalog loads. It is
 * module state rather than a prop because a tool pill deep in a message list
 * needs a color without threading the order through every component.
 */
let groupOrder: string[] = Object.keys(TOOL_GROUP_IDENTITIES);

export function setToolGroupOrder(order: string[]): void {
    if (order.length > 0) {
        groupOrder = order;
    }
}

export function toolGroupVisual(group: string): ToolGroupVisual {
    const identity = TOOL_GROUP_IDENTITIES[group] ?? FALLBACK_IDENTITY;
    const index = groupOrder.indexOf(group);
    const slot = index < 0 ? groupOrder.length : index;
    const total = groupOrder.length + 1;

    return {
        ...identity,
        stops: brandRampStops(slot, total),
        iconStops: brandRampStops(slot, total, { shade: 0.22 }),
    };
}

/**
 * Turns "Search Notes" into "Search" so a group tile reads as a verb set. Falls
 * back to the full display name when stripping leaves nothing, and when two
 * tools in the group would collapse onto the same word.
 */
export function toolVerbLabels(
    group: string,
    tools: { name: string; displayName: string }[],
): Record<string, string> {
    const { nouns } = toolGroupVisual(group);
    const shortened = new Map<string, string>();
    const counts = new Map<string, number>();

    for (const tool of tools) {
        const kept = tool.displayName
            .split(" ")
            .filter((word) => !nouns.includes(word.toLowerCase()));
        const label = kept.length > 0 ? kept.join(" ") : tool.displayName;
        shortened.set(tool.name, label);
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    return Object.fromEntries(
        tools.map((tool) => {
            const label = shortened.get(tool.name) ?? tool.displayName;
            return [tool.name, (counts.get(label) ?? 0) > 1 ? tool.displayName : label];
        }),
    );
}
