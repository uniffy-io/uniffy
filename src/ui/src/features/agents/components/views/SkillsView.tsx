import { useEffect, useMemo } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
    selectSkillSearch,
    setSkillSearch,
    selectSelectedAgentId,
    setSelectedAgent,
} from "@/features/agents/store/agentsUiSlice";
import { selectAllSkills, selectSkillsLoading } from "@/features/agents/store/agentSkillsSlice";
import { selectAllAgents } from "@/features/agents/store/agentsSlice";
import { fetchSkills } from "@/features/agents/store/agentSkillsThunks";
import { fetchAgents, updateAgent } from "@/features/agents/store/agentsThunks";
import { SkillSource } from "@uniffy/proto/agents/v1/skills_pb";

function getSourceLabel(source: number): string {
    switch (source) {
        case SkillSource.BUNDLED:
            return "Bundled";
        case SkillSource.ORGANIZATION:
            return "Organization";
        default:
            return "Unknown";
    }
}

export function SkillsView() {
    const dispatch = useAppDispatch();
    const skillSearch = useAppSelector(selectSkillSearch);
    const skillsMap = useAppSelector(selectAllSkills);
    const loading = useAppSelector(selectSkillsLoading);
    const agentsMap = useAppSelector(selectAllAgents);
    const selectedAgentId = useAppSelector(selectSelectedAgentId);

    const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);
    const skills = useMemo(() => Object.values(skillsMap), [skillsMap]);
    const selectedAgent = useMemo(
        () => (selectedAgentId ? agentsMap[selectedAgentId] ?? null : null),
        [selectedAgentId, agentsMap]
    );

    useEffect(() => {
        dispatch(fetchSkills());
        dispatch(fetchAgents());
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-select default or first agent when none is selected
    useEffect(() => {
        if (!selectedAgentId && agents.length > 0) {
            const defaultAgent = agents.find((a) => a.isDefault) ?? agents[0];
            dispatch(setSelectedAgent(defaultAgent.id));
        }
    }, [selectedAgentId, agents, dispatch]);

    const filteredSkills = useMemo(() => {
        if (!skillSearch.trim()) return skills;
        const query = skillSearch.toLowerCase();
        return skills.filter(
            (skill) =>
                skill.name.toLowerCase().includes(query) ||
                skill.displayName.toLowerCase().includes(query) ||
                skill.description.toLowerCase().includes(query)
        );
    }, [skillSearch, skills]);

    const enabledSkillIds = useMemo(
        () => new Set(selectedAgent?.enabledSkills ?? []),
        [selectedAgent]
    );

    const activeCount = skills.filter(
        (s) => s.alwaysActive || enabledSkillIds.has(s.id)
    ).length;

    const handleToggle = (skillId: string) => {
        if (!selectedAgent) return;
        const currentSkills = selectedAgent.enabledSkills;
        const updated = enabledSkillIds.has(skillId)
            ? currentSkills.filter((id) => id !== skillId)
            : [...currentSkills, skillId];
        dispatch(updateAgent({ agentId: selectedAgent.id, enabledSkills: updated }));
    };

    const agentOptions = useMemo(
        () =>
            agents.map((a) => ({
                value: a.id,
                label: `${a.name}${a.isDefault ? " (default)" : ""}`,
            })),
        [agents],
    );

    if (loading && skills.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <CircleNotch size={32} className="animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
                <h2 className="text-xl font-semibold text-foreground">
                    Skills
                </h2>
                <p className="text-sm text-muted-foreground">
                    Manage agent skills and capabilities
                </p>

                <div className="mt-3 flex items-center gap-3">
                    <Select
                        value={selectedAgentId ?? undefined}
                        onChange={(val) => dispatch(setSelectedAgent(val))}
                        options={agentOptions}
                        placeholder="Select agent..."
                    />
                    <div className="flex-1 max-w-md">
                        <Input
                            value={skillSearch}
                            onChange={(e) =>
                                dispatch(setSkillSearch(e.target.value))
                            }
                            placeholder="Search skills..."
                        />
                    </div>
                    <span className="text-sm text-muted-foreground">
                        {activeCount} active / {skills.length} total
                    </span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredSkills.map((skill) => {
                        const isActive = skill.alwaysActive || enabledSkillIds.has(skill.id);
                        return (
                            <div
                                key={skill.id}
                                className="bg-card border border-border rounded-lg overflow-hidden"
                            >
                                <div className="px-4 py-3 flex items-center gap-3">
                                    <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-sm font-bold text-foreground">
                                        {skill.displayName.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate text-foreground">
                                            {skill.displayName}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {getSourceLabel(skill.source)}
                                        </p>
                                    </div>
                                    {isActive ? (
                                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-transparent">
                                            active
                                        </Badge>
                                    ) : (
                                        <Badge variant="secondary">
                                            inactive
                                        </Badge>
                                    )}
                                </div>

                                <div className="px-4 py-3">
                                    <p className="text-sm text-muted-foreground line-clamp-2">
                                        {skill.description}
                                    </p>
                                </div>

                                <div className="px-4 py-2 border-t border-border flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        {skill.alwaysActive && (
                                            <Badge variant="outline">
                                                Always loaded
                                            </Badge>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleToggle(skill.id)}
                                        disabled={skill.alwaysActive}
                                        className={cn(
                                            "relative w-8 h-4 rounded-full transition-colors cursor-pointer",
                                            isActive
                                                ? "bg-green-500"
                                                : "bg-muted-foreground/30",
                                            skill.alwaysActive && "cursor-not-allowed opacity-50"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
                                                isActive
                                                    ? "translate-x-4"
                                                    : "translate-x-0.5"
                                            )}
                                        />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {filteredSkills.length === 0 && !loading && (
                    <div className="flex items-center justify-center py-12">
                        <p className="text-muted-foreground">No skills found</p>
                    </div>
                )}
            </div>
        </div>
    );
}
