import { useCallback, useEffect, useMemo, useState } from "react";
import {
    CaretDown,
    CaretRight,
    Lock,
    Plus,
    CircleNotch,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { useMyContentRole } from "@/features/permissions";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { roleCanEdit } from "@/shared/utils/contentRoles";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import { selectAllSkills, selectSkillsLoading } from "@/features/agents/store/agentSkillsSlice";
import {
    fetchSkills,
    createSkill,
} from "@/features/agents/store/agentSkillsThunks";
import { updateAgent } from "@/features/agents/store/agentsThunks";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import type { SerializedSkill } from "@/features/agents/store/agentSkillsThunks";
import { SkillSource } from "@uniffy/proto/agents/v1/skills_pb";

function SkillToggle({
    enabled,
    locked,
    disabled,
    onChange,
}: {
    enabled: boolean;
    locked: boolean;
    disabled?: boolean;
    onChange: () => void;
}) {
    if (locked) {
        return (
            <div className="flex items-center gap-1.5">
                <Lock size={14} className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Always on</span>
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={onChange}
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

function SkillRow({
    skill,
    enabled,
    isPersonal,
    disabled,
    onToggle,
}: {
    skill: SerializedSkill;
    enabled: boolean;
    isPersonal: boolean;
    disabled?: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="flex items-center gap-3 px-4 py-3">
            <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-sm font-bold text-foreground shrink-0">
                {skill.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate text-foreground">
                        {skill.displayName}
                    </span>
                    {isPersonal && (
                        <span className="text-xs bg-primary/10 text-primary rounded px-1.5 py-0.5 shrink-0">
                            Mine
                        </span>
                    )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                    {skill.description}
                </p>
            </div>
            <SkillToggle
                enabled={enabled || skill.alwaysActive}
                locked={skill.alwaysActive}
                disabled={disabled}
                onChange={onToggle}
            />
        </div>
    );
}

function CollapsibleSection({
    title,
    count,
    children,
    actions,
}: {
    title: string;
    count: number;
    children: React.ReactNode;
    actions?: React.ReactNode;
}) {
    const [collapsed, setCollapsed] = useState(false);

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
                    {title}
                </span>
                <span className="text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5">
                    {count}
                </span>
                {actions}
            </div>
            {!collapsed && children}
        </div>
    );
}

function NewSkillForm({ onSubmit }: { onSubmit: (params: { name: string; displayName: string; description: string; content: string }) => void }) {
    const [name, setName] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [description, setDescription] = useState("");
    const [content, setContent] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!name.trim() || !displayName.trim() || submitting) return;
        setSubmitting(true);
        try {
            onSubmit({
                name: name.trim(),
                displayName: displayName.trim(),
                description: description.trim(),
                content: content.trim(),
            });
            setName("");
            setDisplayName("");
            setDescription("");
            setContent("");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="p-4 border-t border-border space-y-3">
            <div className="grid grid-cols-2 gap-3">
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Skill name (slug)"
                    className="bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Display name"
                    className="bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
            </div>
            <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description"
                className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="border border-border rounded-lg overflow-hidden bg-muted">
                <CrepeEditor
                    contentType={ContentType.AGENT}
                    contentId=""
                    value={content}
                    onChange={setContent}
                    enableUpload={false}
                    compact
                    minHeight="120px"
                    placeholder="Skill instructions (markdown)"
                />
            </div>
            <button
                type="button"
                onClick={handleSubmit}
                disabled={!name.trim() || !displayName.trim() || submitting}
                className={cn(
                    "bg-primary text-primary-foreground rounded px-3 py-1.5 text-sm transition-colors",
                    name.trim() && displayName.trim() && !submitting
                        ? "hover:bg-primary/90 cursor-pointer"
                        : "opacity-50 cursor-not-allowed"
                )}
            >
                {submitting ? "Creating..." : "Create Skill"}
            </button>
        </div>
    );
}

export function SkillsTab({ agent }: { agent: SerializedAgent }) {
    const dispatch = useAppDispatch();
    const skillsMap = useAppSelector(selectAllSkills);
    const loading = useAppSelector(selectSkillsLoading);
    const currentUserId = useAppSelector((state) => state.auth.user?.id);
    const myRole = useMyContentRole(ContentType.AGENT, agent.id);
    const canEdit = roleCanEdit(myRole);
    const [showNewForm, setShowNewForm] = useState(false);

    const skills = useMemo(() => Object.values(skillsMap), [skillsMap]);

    useEffect(() => {
        dispatch(fetchSkills());
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const enabledSkillIds = useMemo(
        () => new Set(agent.enabledSkills),
        [agent.enabledSkills]
    );

    const bundledSkills = useMemo(
        () => skills.filter((s) => s.source === SkillSource.BUNDLED),
        [skills]
    );
    const orgSkills = useMemo(
        () => skills.filter((s) => s.source === SkillSource.ORGANIZATION),
        [skills]
    );
    const personalSkills = useMemo(
        () =>
            skills.filter(
                (s) =>
                    s.source === SkillSource.PERSONAL &&
                    s.ownerId === currentUserId
            ),
        [skills, currentUserId]
    );

    const handleToggle = useCallback(
        (skillId: string) => {
            const updated = enabledSkillIds.has(skillId)
                ? agent.enabledSkills.filter((id) => id !== skillId)
                : [...agent.enabledSkills, skillId];
            dispatch(updateAgent({ agentId: agent.id, enabledSkills: updated }));
        },
        [agent.id, agent.enabledSkills, enabledSkillIds, dispatch]
    );

    const handleCreatePersonalSkill = useCallback(
        (params: { name: string; displayName: string; description: string; content: string }) => {
            dispatch(createSkill(params));
            setShowNewForm(false);
        },
        [dispatch]
    );

    if (loading && skills.length === 0) {
        return (
            <div className="flex items-center justify-center py-12">
                <CircleNotch size={24} className="animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div>
                <h3 className="font-medium text-foreground">Agent Skills</h3>
                <p className="text-sm text-muted-foreground mt-1">
                    Configure which skills this agent can use
                </p>
            </div>

            <CollapsibleSection title="Bundled" count={bundledSkills.length}>
                <div className="divide-y divide-border">
                    {bundledSkills.map((skill) => (
                        <SkillRow
                            key={skill.id}
                            skill={skill}
                            enabled={enabledSkillIds.has(skill.id)}
                            isPersonal={false}
                            disabled={!canEdit}
                            onToggle={() => handleToggle(skill.id)}
                        />
                    ))}
                    {bundledSkills.length === 0 && (
                        <p className="px-4 py-3 text-sm text-muted-foreground">
                            No bundled skills available
                        </p>
                    )}
                </div>
            </CollapsibleSection>

            <CollapsibleSection title="Organization" count={orgSkills.length}>
                <div className="divide-y divide-border">
                    {orgSkills.map((skill) => (
                        <SkillRow
                            key={skill.id}
                            skill={skill}
                            enabled={enabledSkillIds.has(skill.id)}
                            isPersonal={false}
                            disabled={!canEdit}
                            onToggle={() => handleToggle(skill.id)}
                        />
                    ))}
                    {orgSkills.length === 0 && (
                        <p className="px-4 py-3 text-sm text-muted-foreground">
                            No organization skills available
                        </p>
                    )}
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title="My Skills"
                count={personalSkills.length}
                actions={
                    canEdit ? (
                        <button
                            type="button"
                            onClick={() => setShowNewForm(!showNewForm)}
                            className={cn(
                                "p-1 rounded transition-colors",
                                showNewForm
                                    ? "text-primary bg-primary/10"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Plus size={16} />
                        </button>
                    ) : undefined
                }
            >
                <div className="divide-y divide-border">
                    {personalSkills.map((skill) => (
                        <SkillRow
                            key={skill.id}
                            skill={skill}
                            enabled={enabledSkillIds.has(skill.id)}
                            isPersonal={true}
                            disabled={!canEdit}
                            onToggle={() => handleToggle(skill.id)}
                        />
                    ))}
                    {personalSkills.length === 0 && !showNewForm && (
                        <p className="px-4 py-3 text-sm text-muted-foreground">
                            No personal skills yet
                        </p>
                    )}
                </div>
                {showNewForm && canEdit && <NewSkillForm onSubmit={handleCreatePersonalSkill} />}
            </CollapsibleSection>
        </div>
    );
}
