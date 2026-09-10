import { useAppSelector } from "@/app/hooks";
import { Badge } from "@/components/ui/badge";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  DetailField,
  DetailFieldRow,
} from "@/features/agents/components/instruction/InstructionDetailLayout";
import { selectAgentTools, selectAgentToolsLoading } from "@/features/agents/store/agentToolsSlice";

export function SkillRequirements({
  requiresTools,
  supportedSurfaces,
  onChange,
  disabled = false,
}: {
  requiresTools: string[];
  supportedSurfaces: string[];
  onChange?: (tools: string[]) => void;
  disabled?: boolean;
}) {
  const tools = useAppSelector(selectAgentTools);
  const loading = useAppSelector(selectAgentToolsLoading);
  const options = tools.map((tool) => ({ value: tool.name, label: tool.displayName }));
  const knownTools = new Set(tools.map((tool) => tool.name));

  for (const name of requiresTools) {
    if (!knownTools.has(name)) options.push({ value: name, label: name });
  }

  return (
    <DetailFieldRow>
      <DetailField
        label="Invocation"
        hint={`Supported surfaces: ${supportedSurfaces.length ? supportedSurfaces.join(", ") : "chat and test sessions"}.`}
      >
        <p className="text-sm text-foreground">
          Runs only when you invoke it on an agent it is assigned to.
        </p>
      </DetailField>
      <DetailField
        label="Required tools"
        hint="Choose the tools this skill needs. The agent must have them enabled to run it."
      >
        {onChange ? (
          <MultiSelect
            ariaLabel="Required tools"
            value={requiresTools}
            options={options}
            onChange={onChange}
            disabled={disabled || loading}
            placeholder={loading ? "Loading tools..." : "Select required tools (optional)"}
          />
        ) : requiresTools.length === 0 ? (
          <p className="text-sm text-muted-foreground">None</p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="skill-requirements">
            {requiresTools.map((tool) => (
              <Badge key={tool} variant="outline">
                {options.find((option) => option.value === tool)?.label ?? tool}
              </Badge>
            ))}
          </div>
        )}
      </DetailField>
    </DetailFieldRow>
  );
}
