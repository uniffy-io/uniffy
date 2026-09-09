import type { SerializedSkillCompatibility } from "@/features/agents/store/agentRunnableSkillsThunks";

export function SkillCompatibilityNotice({
  diagnostic,
  toolLabels,
}: {
  diagnostic?: SerializedSkillCompatibility;
  toolLabels: Record<string, string>;
}) {
  if (!diagnostic) return null;
  if (diagnostic.unavailable) {
    return <p className="mt-1 text-xs text-muted-foreground">This skill is unavailable.</p>;
  }
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {diagnostic.missingTools.length > 0 && (
        <p className="mt-1">
          Required tools unavailable:{" "}
          {diagnostic.missingTools.map((name) => toolLabels[name] ?? name).join(", ")}. Enable them
          and check their connections.
        </p>
      )}
      {diagnostic.unsupportedSurfaces.includes("chat") && (
        <p className="mt-1">Not available in chat.</p>
      )}
      {diagnostic.unsupportedSurfaces.includes("session") && (
        <p className="mt-1">Not available in the Test Drawer.</p>
      )}
    </div>
  );
}
