import { useCallback, useMemo, useState } from "react";
import { CaretDown, CaretRight, WarningCircle } from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { useMyContentRole } from "@/features/permissions";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { roleCanEdit } from "@/shared/utils/contentRoles";
import { TOOL_SECTIONS } from "@/features/agents/config/toolCatalog";
import type { ToolGroup, ToolCategorySection } from "@/features/agents/config/toolCatalog";
import { updateAgent } from "@/features/agents/store/agentsThunks";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";

function ToolToggle({
    enabled,
    disabled,
    onChange,
}: {
    enabled: boolean;
    disabled?: boolean;
    onChange: (enabled: boolean) => void;
}) {
    return (
        <button
            type="button"
            onClick={() => onChange(!enabled)}
            disabled={disabled}
            className={cn(
                "relative inline-flex shrink-0 w-9 h-5 rounded-full transition-colors",
                enabled ? "bg-green-500" : "bg-muted-foreground/30",
                disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
            )}
        >
            <span
                className={cn(
                    "pointer-events-none absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
                    enabled ? "translate-x-4" : "translate-x-0"
                )}
            />
        </button>
    );
}

function GroupSection({
    group,
    enabledTools,
    disabled,
    onToggle,
    onToggleAll,
}: {
    group: ToolGroup;
    enabledTools: Set<string>;
    disabled?: boolean;
    onToggle: (toolName: string, enabled: boolean) => void;
    onToggleAll: (groupTools: string[], enabled: boolean) => void;
}) {
    const [collapsed, setCollapsed] = useState(false);

    const groupToolNames = useMemo(
        () => group.tools.map((t) => t.name),
        [group.tools]
    );
    const enabledInGroup = useMemo(
        () => groupToolNames.filter((name) => enabledTools.has(name)).length,
        [groupToolNames, enabledTools]
    );
    const allEnabled = enabledInGroup === group.tools.length;

    return (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                <button
                    type="button"
                    onClick={() => setCollapsed(!collapsed)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                >
                    {collapsed ? <CaretRight size={16} /> : <CaretDown size={16} />}
                </button>
                <span className="text-sm font-medium text-foreground flex-1">
                    {group.group}
                </span>
                <span className="text-xs text-muted-foreground">
                    {enabledInGroup}/{group.tools.length}
                </span>
                <label className={cn("flex items-center gap-2", disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer")}>
                    <span className="text-xs text-muted-foreground">All</span>
                    <input
                        type="checkbox"
                        checked={allEnabled}
                        onChange={() => onToggleAll(groupToolNames, !allEnabled)}
                        disabled={disabled}
                        className="rounded border-border text-primary focus:ring-ring"
                    />
                </label>
            </div>
            {!collapsed && (
                <div className="divide-y divide-border">
                    {group.tools.map((tool) => (
                        <div
                            key={tool.name}
                            className="flex items-center gap-3 px-4 py-3"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-foreground">
                                        {tool.displayName}
                                    </span>
                                    {tool.destructive && (
                                        <WarningCircle
                                            size={14}
                                            weight="fill"
                                            className="text-yellow-500 shrink-0"
                                        />
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    {tool.description}
                                </p>
                            </div>
                            <ToolToggle
                                enabled={enabledTools.has(tool.name)}
                                disabled={disabled}
                                onChange={(enabled) => onToggle(tool.name, enabled)}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function CategorySection({
    section,
    enabledTools,
    enabledCount,
    totalCount,
    disabled,
    onToggle,
    onToggleAll,
}: {
    section: ToolCategorySection;
    enabledTools: Set<string>;
    enabledCount: number;
    totalCount: number;
    disabled?: boolean;
    onToggle: (toolName: string, enabled: boolean) => void;
    onToggleAll: (groupTools: string[], enabled: boolean) => void;
}) {
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-medium text-foreground">{section.label}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        {section.description}
                    </p>
                </div>
                <span className="text-sm text-muted-foreground">
                    {enabledCount}/{totalCount} enabled
                </span>
            </div>
            {section.groups.map((group) => (
                <GroupSection
                    key={group.group}
                    group={group}
                    enabledTools={enabledTools}
                    disabled={disabled}
                    onToggle={onToggle}
                    onToggleAll={onToggleAll}
                />
            ))}
        </div>
    );
}

export function ToolsTab({ agent }: { agent: SerializedAgent }) {
    const dispatch = useAppDispatch();
    const myRole = useMyContentRole(ContentType.AGENT, agent.id);
    const canEdit = roleCanEdit(myRole);

    const enabledTools = useMemo(
        () => new Set(agent.enabledTools),
        [agent.enabledTools]
    );

    const sectionCounts = useMemo(() => {
        const counts: Record<string, { enabled: number; total: number }> = {};
        for (const section of TOOL_SECTIONS) {
            let total = 0;
            let enabled = 0;
            for (const group of section.groups) {
                total += group.tools.length;
                enabled += group.tools.filter((t) => enabledTools.has(t.name)).length;
            }
            counts[section.category] = { enabled, total };
        }
        return counts;
    }, [enabledTools]);

    const handleToggle = useCallback(
        (toolName: string, enabled: boolean) => {
            const updated = enabled
                ? [...agent.enabledTools, toolName]
                : agent.enabledTools.filter((t) => t !== toolName);
            dispatch(updateAgent({ agentId: agent.id, enabledTools: updated }));
        },
        [agent.id, agent.enabledTools, dispatch]
    );

    const handleToggleAll = useCallback(
        (groupTools: string[], enabled: boolean) => {
            const current = new Set(agent.enabledTools);
            for (const tool of groupTools) {
                if (enabled) {
                    current.add(tool);
                } else {
                    current.delete(tool);
                }
            }
            dispatch(
                updateAgent({ agentId: agent.id, enabledTools: [...current] })
            );
        },
        [agent.id, agent.enabledTools, dispatch]
    );

    return (
        <div className="space-y-8">
            {TOOL_SECTIONS.map((section) => {
                const counts = sectionCounts[section.category] ?? { enabled: 0, total: 0 };
                return (
                    <CategorySection
                        key={section.category}
                        section={section}
                        enabledTools={enabledTools}
                        enabledCount={counts.enabled}
                        totalCount={counts.total}
                        disabled={!canEdit}
                        onToggle={handleToggle}
                        onToggleAll={handleToggleAll}
                    />
                );
            })}
        </div>
    );
}
