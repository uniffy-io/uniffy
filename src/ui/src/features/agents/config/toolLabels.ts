/**
 * Tool display names for code that runs outside React and cannot read the
 * store - the tool-activity pane labels steps while a run streams. The tools
 * thunk fills this on fetch; until then, and for a tool the server no longer
 * ships, the name itself is title-cased.
 */

const displayNames = new Map<string, string>();

/**
 * Providers require `[a-zA-Z0-9_-]` tool names, so the wire replaces the
 * internal dots with hyphens (`notes.create_note` -> `notes-create_note`) and
 * chat rows persist that form. Internal names never contain hyphens, so the
 * reverse mapping is lossless.
 */
export function internalToolName(toolName: string): string {
  return toolName.replace(/-/g, ".");
}

export function rememberToolLabels(tools: { name: string; displayName: string }[]): void {
  for (const tool of tools) {
    if (tool.displayName) {
      displayNames.set(tool.name, tool.displayName);
    }
  }
}

/**
 * First sentence of a tool's description, for a scannable checkbox row. The
 * full text is written for the model - it names sibling tools and argument
 * values - so the row shows the lead and hover reveals the rest.
 */
export function toolSummary(description: string): string {
  const end = description.search(/\.\s/);
  return end === -1 ? description : description.slice(0, end + 1);
}

export function toolActionLabel(toolName: string): string {
  const internal = internalToolName(toolName);
  const known = displayNames.get(internal);
  if (known) return known;

  const parts = internal.split(".");
  const action = parts[parts.length - 1] ?? "";
  return action
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
