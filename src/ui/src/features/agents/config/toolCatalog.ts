/**
 * Shapes for the tool catalog. The catalog itself is server-owned and arrives
 * over `AgentsService.ListTools` - a tool's name, label, description, group and
 * category live next to its definition in the backend, so the two cannot drift.
 * What stays here is the copy that names the surface rather than the tools.
 */

export interface ToolEntry {
  name: string;
  displayName: string;
  description: string;
  destructive: boolean;
}

export interface ToolGroup {
  group: string;
  tools: ToolEntry[];
  /** Integration provider id whose org connection these tools call through. */
  requiresConnection?: string;
}

export type ToolCategory = "platform" | "external";

export interface ToolCategorySection {
  category: string;
  label: string;
  description: string;
  groups: ToolGroup[];
}

/** Section chrome, keyed by the `category` the server sends. */
export const CATEGORY_SECTIONS: Record<string, { label: string; description: string }> = {
  platform: {
    label: "Platform Tools",
    description: "Select which workspace tools this agent can use",
  },
  external: {
    label: "External Tools",
    description: "Tools that use external provider APIs",
  },
};

// The only tool that needs the image model configured to do anything.
export const IMAGE_GENERATION_TOOL = "images.generate_image";
