import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    ArrowLeft,
    Books,
    Cpu,
    Image,
    Lightning,
    MagnifyingGlass,
    Plus,
    Warning,
} from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";
import {
    toolGroupVisual,
    toolVerbLabels,
} from "@/features/agents/config/toolGroupVisuals";
import { brandAlpha, brandGradient } from "@/config/theme/brandGradients";
import { selectAllSkills } from "@/features/agents/store/agentSkillsSlice";
import { selectAvailableModels } from "@/features/agents/store/agentProvidersSlice";
import {
    selectAgentTemplates,
    selectAgentTemplatesLoaded,
} from "@/features/agents/store/agentTemplatesSlice";
import type { SerializedAgentTemplate } from "@/features/agents/store/agentTemplatesThunks";
import {
    selectToolGroupOrder,
    selectToolsByName,
} from "@/features/agents/store/agentToolsSlice";
import type { SerializedTool } from "@/features/agents/store/agentToolsThunks";

interface CatalogViewProps {
    onUseTemplate: (templateKey?: string) => void;
}

type ToolMeta = SerializedTool;

function groupTools(
    toolNames: string[],
    toolsByName: Map<string, ToolMeta>,
    groupOrder: string[],
) {
    const groups = new Map<string, { name: string; meta: ToolMeta }[]>();
    for (const name of toolNames) {
        const meta = toolsByName.get(name);
        if (!meta) continue;
        const bucket = groups.get(meta.group) ?? [];
        bucket.push({ name, meta });
        groups.set(meta.group, bucket);
    }
    // Catalog order, not the order the template happens to list its tools in,
    // so the tiles also come out in ramp order.
    return [...groups.entries()].sort(
        ([a], [b]) => groupOrder.indexOf(a) - groupOrder.indexOf(b),
    );
}

function CapabilityTile({
    group,
    tools,
}: {
    group: string;
    tools: { name: string; meta: ToolMeta }[];
}) {
    const { icon: GroupIcon, stops, iconStops } = toolGroupVisual(group);
    // A handful of string splits per tile; memoizing costs more than it saves.
    const verbs = toolVerbLabels(
        group,
        tools.map(({ name, meta }) => ({ name, displayName: meta.displayName })),
    );

    return (
        <div
            className="flex flex-col gap-3 rounded-xl border p-4"
            style={{
                background: `linear-gradient(135deg, ${brandAlpha(stops.start, 0.12)}, ${brandAlpha(stops.end, 0.04)} 70%, transparent)`,
                borderColor: brandAlpha(stops.start, 0.32),
            }}
            data-testid={`agents-catalog-capability-${group.toLowerCase()}`}
        >
            <div className="flex items-center gap-2.5">
                <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
                    style={{ background: brandGradient(iconStops) }}
                >
                    <GroupIcon size={16} weight="duotone" />
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                    {group}
                </p>
                <span className="text-xs font-medium tabular-nums text-muted-foreground">
                    {tools.length}
                </span>
            </div>

            <div className="flex flex-wrap gap-1">
                {tools.map(({ name, meta }) => (
                    <span
                        key={name}
                        title={meta.description}
                        className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            meta.destructive
                                ? "bg-amber-100 text-amber-800 ring-1 ring-amber-400/60 dark:bg-amber-900/30 dark:text-amber-400 dark:ring-amber-500/40"
                                : "text-foreground/85",
                        )}
                        style={
                            meta.destructive
                                ? undefined
                                : { background: brandAlpha(stops.start, 0.16) }
                        }
                        data-tool-name={name}
                    >
                        {meta.destructive && <Warning size={10} weight="fill" />}
                        {verbs[name] ?? meta.displayName}
                    </span>
                ))}
            </div>
        </div>
    );
}

function TemplateCard({
    template,
    skillLabels,
    onOpen,
    onUse,
}: {
    template: SerializedAgentTemplate;
    skillLabels: string[];
    onOpen: () => void;
    onUse: () => void;
}) {
    const toolsByName = useAppSelector(selectToolsByName);
    const groupOrder = useAppSelector(selectToolGroupOrder);
    const groupNames = useMemo(
        () => groupTools(template.enabledTools, toolsByName, groupOrder).map(([group]) => group),
        [template.enabledTools, toolsByName, groupOrder],
    );
    const shownGroups = groupNames.slice(0, 5);
    const hiddenGroupCount = groupNames.length - shownGroups.length;

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen();
                }
            }}
            data-testid={`agents-catalog-card-${template.key}`}
            className={cn(
                "group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left",
                "cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/30",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
        >
            <div className="flex items-start gap-3">
                <AgentAvatar
                    avatarEmoji={template.emoji}
                    agentName={template.name}
                    size="lg"
                />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{template.name}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {template.description}
                    </p>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-1">
                <span className="flex items-center gap-1" title={groupNames.join(", ")}>
                    {shownGroups.map((group) => {
                        const { icon: GroupIcon, iconStops } = toolGroupVisual(group);
                        return (
                            <span
                                key={group}
                                className="flex h-5 w-5 items-center justify-center rounded-md text-white"
                                style={{ background: brandGradient(iconStops) }}
                            >
                                <GroupIcon size={11} weight="duotone" />
                            </span>
                        );
                    })}
                    <span className="ml-0.5 text-[10px] font-medium text-muted-foreground">
                        {hiddenGroupCount > 0 && `+${hiddenGroupCount} `}
                        {template.enabledTools.length} tools
                    </span>
                </span>
                {skillLabels.map((label) => (
                    <Badge key={label} variant="secondary" className="gap-1 text-[10px] font-medium">
                        <Lightning size={10} />
                        {label}
                    </Badge>
                ))}
            </div>

            <div className="mt-auto flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                    View details
                </span>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                        e.stopPropagation();
                        onUse();
                    }}
                    data-testid={`agents-catalog-use-${template.key}`}
                >
                    <Plus size={14} />
                    Use
                </Button>
            </div>
        </div>
    );
}

function TemplateDetail({
    template,
    skillLabels,
    onBack,
    onUse,
}: {
    template: SerializedAgentTemplate;
    skillLabels: string[];
    onBack: () => void;
    onUse: () => void;
}) {
    const toolsByName = useAppSelector(selectToolsByName);
    const groupOrder = useAppSelector(selectToolGroupOrder);
    const toolGroups = useMemo(
        () => groupTools(template.enabledTools, toolsByName, groupOrder),
        [template.enabledTools, toolsByName, groupOrder],
    );
    const destructiveCount = template.enabledTools.filter(
        (name) => toolsByName.get(name)?.destructive,
    ).length;
    const availableModels = useAppSelector(selectAvailableModels);
    const recommendedModel = template.recommendedModel
        ? (availableModels.find((m) => m.id === template.recommendedModel) ?? null)
        : null;
    const recommendedImageModel = template.recommendedImageModel
        ? (availableModels.find((m) => m.id === template.recommendedImageModel) ?? null)
        : null;

    return (
        <div
            className="flex-1 overflow-y-auto"
            data-testid="agents-catalog-detail"
            data-template-key={template.key}
        >
            <div className="mx-auto w-full max-w-3xl px-6 py-6">
                <button
                    type="button"
                    onClick={onBack}
                    className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    data-testid="agents-catalog-back"
                >
                    <ArrowLeft size={14} />
                    All templates
                </button>

                <div className="flex items-start gap-4">
                    <AgentAvatar
                        avatarEmoji={template.emoji}
                        agentName={template.name}
                        size="xl"
                    />
                    <div className="min-w-0 flex-1">
                        <h1 className="text-xl font-semibold text-foreground">{template.name}</h1>
                        <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
                        {(template.recommendedModel || template.recommendedImageModel) && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                                {template.recommendedModel && (
                                    <Badge
                                        variant="secondary"
                                        className="gap-1 text-[10px]"
                                        data-testid="agents-catalog-recommended-model"
                                    >
                                        <Cpu size={10} />
                                        {recommendedModel?.displayName ??
                                            template.recommendedModel}
                                    </Badge>
                                )}
                                {template.recommendedImageModel && (
                                    <Badge
                                        variant="secondary"
                                        className="gap-1 text-[10px]"
                                        data-testid="agents-catalog-recommended-image-model"
                                    >
                                        <Image size={10} />
                                        {recommendedImageModel?.displayName ??
                                            template.recommendedImageModel}
                                    </Badge>
                                )}
                            </div>
                        )}
                    </div>
                    <Button onClick={onUse} data-testid="agents-catalog-detail-use">
                        <Plus size={16} />
                        Use this template
                    </Button>
                </div>

                <section className="mt-8">
                    <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Instructions
                    </h2>
                    <p className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed text-foreground">
                        {template.soulPrompt}
                    </p>
                </section>

                {skillLabels.length > 0 && (
                    <section className="mt-8">
                        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Skills
                        </h2>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {skillLabels.map((label) => (
                                <Badge key={label} variant="secondary" className="gap-1">
                                    <Lightning size={12} />
                                    {label}
                                </Badge>
                            ))}
                        </div>
                    </section>
                )}

                <section className="mt-8">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Tools
                        </h2>
                        <span className="text-xs text-muted-foreground">
                            {template.enabledTools.length} across {toolGroups.length}{" "}
                            {toolGroups.length === 1 ? "area" : "areas"}
                        </span>
                        {destructiveCount > 0 && (
                            <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                                <Warning size={13} weight="fill" />
                                {destructiveCount} delete content and ask before they run
                            </span>
                        )}
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {toolGroups.map(([group, tools]) => (
                            <CapabilityTile key={group} group={group} tools={tools} />
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}

export function CatalogView({ onUseTemplate }: CatalogViewProps) {
    const navigate = useNavigate();
    const { subId: templateKey } = useParams<{ subId?: string }>();
    const templates = useAppSelector(selectAgentTemplates);
    const templatesLoaded = useAppSelector(selectAgentTemplatesLoaded);
    const skillsMap = useAppSelector(selectAllSkills);

    const [search, setSearch] = useState("");

    const skillLabelsFor = (template: SerializedAgentTemplate) =>
        template.enabledSkillIds.map((id) => skillsMap[id]?.displayName ?? "Skill");

    const query = search.trim().toLowerCase();
    const filtered = useMemo(() => {
        if (!query) return templates;
        return templates.filter((template) =>
            [template.name, template.description, ...template.enabledTools]
                .join(" ")
                .toLowerCase()
                .includes(query),
        );
    }, [templates, query]);

    const selected = templateKey
        ? templates.find((template) => template.key === templateKey) ?? null
        : null;

    if (templateKey && selected) {
        return (
            <div className="flex h-full flex-col overflow-hidden" data-testid="agents-catalog-view">
                <TemplateDetail
                    template={selected}
                    skillLabels={skillLabelsFor(selected)}
                    onBack={() => navigate("/agents/catalog")}
                    onUse={() => onUseTemplate(selected.key)}
                />
            </div>
        );
    }

    // A key that no longer ships resolves to nothing; fall through to the grid
    // rather than stranding the URL on a blank pane.
    return (
        <div className="flex h-full flex-col overflow-hidden" data-testid="agents-catalog-view">
            <div className="border-b border-border/60 bg-card px-6 py-4">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                        <h1 className="text-lg font-semibold text-foreground">Agent catalog</h1>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                            Ready-made agents to start from. Everything is editable once created.
                        </p>
                    </div>
                    <div className="relative w-full sm:w-64">
                        <MagnifyingGlass
                            size={14}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                            type="text"
                            placeholder="Search templates..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-8 pl-8 text-xs"
                            data-testid="agents-catalog-search"
                        />
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
                <div
                    className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
                    data-testid="agents-catalog-grid"
                >
                    <button
                        type="button"
                        onClick={() => onUseTemplate()}
                        data-testid="agents-catalog-card-blank"
                        className={cn(
                            "flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-card p-4 text-left",
                            "transition-colors hover:border-primary/50 hover:bg-muted/30",
                        )}
                    >
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <Plus size={18} weight="bold" />
                        </span>
                        <span className="text-sm font-semibold text-foreground">Blank agent</span>
                        <span className="text-xs leading-relaxed text-muted-foreground">
                            No instructions, no tools. Configure everything yourself.
                        </span>
                    </button>

                    {filtered.map((template) => (
                        <TemplateCard
                            key={template.key}
                            template={template}
                            skillLabels={skillLabelsFor(template)}
                            onOpen={() => navigate(`/agents/catalog/${template.key}`)}
                            onUse={() => onUseTemplate(template.key)}
                        />
                    ))}
                </div>

                {templatesLoaded && filtered.length === 0 && (
                    <div className="flex flex-col items-center py-12 text-center">
                        <Books size={40} weight="light" className="mb-3 text-muted-foreground/30" />
                        <p className="text-sm text-muted-foreground">
                            No template matches &ldquo;{search.trim()}&rdquo;
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
