import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
    Brain,
    ImageSquare,
    Lightning,
    Wrench,
    Star,
    Textbox,
    SmileySticker,
    ArrowsDownUp,
    Key,
    ArrowRight,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { selectProviderKeys, selectModelsForKey } from "@/features/agents/store/agentProvidersSlice";
import { fetchModelsForKey } from "@/features/agents/store/agentProvidersThunks";
import { updateAgent, uploadAgentAvatar, deleteAgentAvatar } from "@/features/agents/store/agentsThunks";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import { AvatarUpload } from "@/components/ui/avatar-upload";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select, type SelectOption } from "@/components/ui/select";
import { useMyContentRole } from "@/features/permissions";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { roleCanEdit } from "@/shared/utils/contentRoles";

function SectionHeader({
    icon: Icon,
    title,
    subtitle,
}: {
    icon: React.ElementType;
    title: string;
    subtitle?: string;
}) {
    return (
        <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <Icon size={18} weight="duotone" className="text-primary" />
            </div>
            <div>
                <h3 className="text-sm font-semibold text-foreground tracking-tight">
                    {title}
                </h3>
                {subtitle && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {subtitle}
                    </p>
                )}
            </div>
        </div>
    );
}

function StatCard({
    icon: Icon,
    label,
    value,
    accentClass,
}: {
    icon: React.ElementType;
    label: string;
    value: string | number;
    accentClass: string;
}) {
    return (
        <div className="group relative bg-card border border-border rounded-xl p-4 overflow-hidden transition-colors hover:border-border/80">
            <div className={cn(
                "absolute top-0 left-0 w-full h-0.5",
                accentClass,
            )} />
            <div className="flex items-center gap-3">
                <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                    accentClass.replace("bg-", "bg-").replace("/80", "/10"),
                    "bg-muted",
                )}>
                    <Icon size={16} weight="duotone" className="text-muted-foreground" />
                </div>
                <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-lg font-semibold text-foreground tabular-nums leading-tight">
                        {value}
                    </p>
                </div>
            </div>
        </div>
    );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
    return (
        <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
            {children}
        </label>
    );
}

export function OverviewTab({ agent }: { agent: SerializedAgent }) {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const providerKeys = useAppSelector(selectProviderKeys);

    const myRole = useMyContentRole(ContentType.AGENT, agent.id);
    const canEdit = roleCanEdit(myRole);

    const primaryKeyId = agent.primaryProviderKeyId || "";
    const imageKeyId = agent.imageProviderKeyId || "";

    const primaryKeyModels = useAppSelector(selectModelsForKey(primaryKeyId));
    const imageKeyModels = useAppSelector(selectModelsForKey(imageKeyId));

    useEffect(() => {
        if (primaryKeyId) {
            dispatch(fetchModelsForKey({ keyId: primaryKeyId }));
        }
    }, [dispatch, primaryKeyId]);

    useEffect(() => {
        if (imageKeyId) {
            dispatch(fetchModelsForKey({ keyId: imageKeyId }));
        }
    }, [dispatch, imageKeyId]);

    const enabledKeys = useMemo(
        () => Object.values(providerKeys).filter((k) => k.isValid && k.isEnabled),
        [providerKeys],
    );

    const allKeys = useMemo(() => Object.values(providerKeys), [providerKeys]);
    const hasAnyKeys = allKeys.length > 0;

    const keyOptions: SelectOption<string>[] = useMemo(() => [
        { value: "", label: "No key assigned" },
        ...enabledKeys.map((k) => ({
            value: k.id,
            label: `${k.label} (${k.provider})`,
        })),
    ], [enabledKeys]);

    const primaryModelOptions: SelectOption<string>[] = useMemo(() => {
        const opts = primaryKeyModels.map((m) => ({
            value: m.id,
            label: `${m.displayName}`,
        }));
        if (agent.primaryModel && !primaryKeyModels.some((m) => m.id === agent.primaryModel)) {
            opts.unshift({ value: agent.primaryModel, label: agent.primaryModel });
        }
        return opts;
    }, [primaryKeyModels, agent.primaryModel]);

    const imageModelOptions: SelectOption<string>[] = useMemo(() => {
        const opts: SelectOption<string>[] = [
            { value: "", label: "Disabled" },
            ...imageKeyModels
                .filter((m) => m.id.includes("image") || m.id.includes("dall-e") || m.id.includes("gpt-image"))
                .map((m) => ({ value: m.id, label: m.displayName })),
        ];
        for (const m of imageKeyModels) {
            if (!opts.some((o) => o.value === m.id)) {
                opts.push({ value: m.id, label: m.displayName });
            }
        }
        if (agent.imageModel && !opts.some((o) => o.value === agent.imageModel)) {
            opts.push({ value: agent.imageModel, label: agent.imageModel });
        }
        return opts;
    }, [imageKeyModels, agent.imageModel]);

    const fallbackModelOptions = useMemo(
        () =>
            primaryKeyModels
                .filter((m) => m.id !== agent.primaryModel)
                .map((m) => ({ value: m.id, label: `${m.displayName}` })),
        [primaryKeyModels, agent.primaryModel],
    );

    const handleUpdate = (fields: Omit<Parameters<typeof updateAgent>[0], 'agentId'>) => {
        dispatch(updateAgent({ agentId: agent.id, ...fields }));
    };

    const handleAvatarUpload = useCallback(
        async (file: File) => {
            const buffer = await file.arrayBuffer();
            dispatch(uploadAgentAvatar({
                agentId: agent.id,
                imageData: new Uint8Array(buffer),
                filename: file.name,
            }));
        },
        [dispatch, agent.id],
    );

    const handleAvatarDelete = useCallback(async () => {
        await dispatch(deleteAgentAvatar(agent.id));
    }, [dispatch, agent.id]);

    const [nameState, setNameState] = useState({ id: agent.id, value: agent.name });
    if (nameState.id !== agent.id) {
        setNameState({ id: agent.id, value: agent.name });
    }
    const nameValue = nameState.value;
    const nameChanged = nameValue.trim() !== "" && nameValue !== agent.name;

    const handleSaveName = () => {
        const trimmed = nameValue.trim();
        if (trimmed && trimmed !== agent.name) {
            handleUpdate({ name: trimmed });
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300">
            {/* --- Identity Hero --- */}
            <div className="relative bg-card border border-border rounded-xl overflow-hidden">
                {/* Decorative top gradient bar */}
                <div className="h-1 bg-gradient-to-r from-primary/80 via-primary/40 to-transparent" />

                <div className="p-6">
                    <div className="flex items-start gap-6">
                        {/* Avatar column */}
                        <div className="shrink-0">
                            <AvatarUpload
                                imageUrl={agent.avatarKey || undefined}
                                fallback={agent.avatarEmoji || agent.name.charAt(0)}
                                size="lg"
                                onUpload={handleAvatarUpload}
                                onDelete={handleAvatarDelete}
                                disabled={!canEdit}
                            />
                        </div>

                        {/* Identity fields */}
                        <div className="flex-1 min-w-0 space-y-4">
                            <div>
                                <FieldLabel>
                                    <span className="inline-flex items-center gap-1.5">
                                        <Textbox size={12} weight="bold" />
                                        Name
                                    </span>
                                </FieldLabel>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        className={cn(
                                            "flex-1 bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground",
                                            "focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring",
                                            "transition-all placeholder:text-muted-foreground",
                                            !canEdit && "opacity-50 cursor-not-allowed",
                                        )}
                                        value={nameValue}
                                        onChange={(e) => setNameState({ id: agent.id, value: e.target.value })}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" && nameChanged) {
                                                handleSaveName();
                                            }
                                        }}
                                        placeholder="Agent name"
                                        disabled={!canEdit}
                                    />
                                    {nameChanged && (
                                        <Button size="md" onClick={handleSaveName}>
                                            Save
                                        </Button>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-end gap-4">
                                <div>
                                    <FieldLabel>
                                        <span className="inline-flex items-center gap-1.5">
                                            <SmileySticker size={12} weight="bold" />
                                            Fallback Emoji
                                        </span>
                                    </FieldLabel>
                                    <input
                                        type="text"
                                        className={cn(
                                            "w-16 bg-muted/50 border border-border rounded-lg px-3 py-2 text-center text-base text-foreground",
                                            "focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring transition-all",
                                            !canEdit && "opacity-50 cursor-not-allowed",
                                        )}
                                        value={agent.avatarEmoji}
                                        maxLength={2}
                                        onChange={(e) => handleUpdate({ avatarEmoji: e.target.value })}
                                        placeholder="AI"
                                        disabled={!canEdit}
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground pb-2.5">
                                    Displayed when no avatar image is uploaded
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* --- Model Configuration (unified two-column) --- */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="p-6 pb-5">
                    <SectionHeader
                        icon={Brain}
                        title="Model Configuration"
                        subtitle="Configure the LLM providers and models this agent uses"
                    />

                    {!hasAnyKeys ? (
                        /* Empty state: no provider keys configured */
                        <div className="relative border border-dashed border-border rounded-xl p-8 text-center overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/3 pointer-events-none" />
                            <div className="relative">
                                <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
                                    <Key size={28} weight="duotone" className="text-primary" />
                                </div>
                                <h4 className="text-sm font-semibold text-foreground mb-1.5">
                                    No provider keys configured
                                </h4>
                                <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-5">
                                    Add an API key from Anthropic, OpenAI, or Google to start using this agent.
                                    Provider keys are managed in the configuration panel.
                                </p>
                                <Button
                                    size="md"
                                    onClick={() => navigate("/agents/config")}
                                >
                                    <Key size={16} weight="bold" />
                                    Add Provider Key
                                    <ArrowRight size={14} />
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                {/* Primary Model column */}
                                <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-4">
                                    <div className="flex items-center gap-2 pb-2 border-b border-border">
                                        <Brain size={16} weight="duotone" className="text-primary" />
                                        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                                            Chat Model
                                        </span>
                                    </div>
                                    <div>
                                        <FieldLabel>Provider Key</FieldLabel>
                                        <Select
                                            value={primaryKeyId}
                                            onChange={(value) => handleUpdate({
                                                primaryProviderKeyId: value,
                                            })}
                                            options={keyOptions}
                                            placeholder="Select provider key..."
                                            disabled={!canEdit}
                                            className="w-full"
                                        />
                                    </div>
                                    <div>
                                        <FieldLabel>Model</FieldLabel>
                                        <Select
                                            value={agent.primaryModel}
                                            onChange={(value) => handleUpdate({ primaryModel: value })}
                                            options={primaryModelOptions}
                                            placeholder={primaryKeyId ? "Select model..." : "Select a provider key first"}
                                            disabled={!canEdit || !primaryKeyId}
                                            className="w-full"
                                        />
                                    </div>
                                </div>

                                {/* Image Generation column */}
                                <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-4">
                                    <div className="flex items-center gap-2 pb-2 border-b border-border">
                                        <ImageSquare size={16} weight="duotone" className="text-primary" />
                                        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                                            Image Model
                                        </span>
                                    </div>
                                    <div>
                                        <FieldLabel>Provider Key</FieldLabel>
                                        <Select
                                            value={imageKeyId}
                                            onChange={(value) => handleUpdate({
                                                imageProviderKeyId: value,
                                            })}
                                            options={keyOptions}
                                            placeholder="Select provider key..."
                                            disabled={!canEdit}
                                            className="w-full"
                                        />
                                    </div>
                                    <div>
                                        <FieldLabel>Model</FieldLabel>
                                        <Select
                                            value={agent.imageModel}
                                            onChange={(value) => handleUpdate({ imageModel: value })}
                                            options={imageModelOptions}
                                            placeholder={imageKeyId ? "Select model..." : "Select a provider key first"}
                                            disabled={!canEdit || !imageKeyId}
                                            className="w-full"
                                        />
                                        <p className="text-xs text-muted-foreground mt-1.5">
                                            Used for the image generation tool
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Fallback models - full width below the grid */}
                            <div className="mt-5 bg-muted/30 border border-border rounded-xl p-4">
                                <div className="flex items-center gap-2 pb-2 mb-3 border-b border-border">
                                    <ArrowsDownUp size={16} weight="duotone" className="text-muted-foreground" />
                                    <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                                        Fallback Models
                                    </span>
                                </div>
                                <MultiSelect
                                    value={agent.fallbackModels}
                                    onChange={(models) => handleUpdate({ fallbackModels: models })}
                                    options={fallbackModelOptions}
                                    placeholder={primaryKeyId ? "Select fallback models..." : "Select a primary key first"}
                                    disabled={!canEdit || !primaryKeyId}
                                />
                                <p className="text-xs text-muted-foreground mt-1.5">
                                    Used automatically when the primary chat model is unavailable
                                </p>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* --- Agent Settings --- */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="p-6">
                    <SectionHeader
                        icon={Star}
                        title="Agent Settings"
                        subtitle="General configuration and capability overview"
                    />

                    {/* Default agent toggle */}
                    <div className="flex items-center justify-between bg-muted/30 border border-border rounded-xl p-4 mb-5">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                <Star size={16} weight="duotone" className="text-primary" />
                            </div>
                            <div>
                                <span className="text-sm font-medium text-foreground">
                                    Default Agent
                                </span>
                                <p className="text-xs text-muted-foreground">
                                    Used when creating new sessions without specifying an agent
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => handleUpdate({ isDefault: !agent.isDefault })}
                            disabled={!canEdit}
                            className={cn(
                                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0",
                                agent.isDefault ? "bg-primary" : "bg-muted border border-border",
                                !canEdit && "opacity-50 cursor-not-allowed"
                            )}
                        >
                            <span
                                className={cn(
                                    "inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                                    agent.isDefault ? "translate-x-6" : "translate-x-1"
                                )}
                            />
                        </button>
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 gap-3">
                        <StatCard
                            icon={Lightning}
                            label="Skills Enabled"
                            value={agent.enabledSkills.length}
                            accentClass="bg-amber-500/80"
                        />
                        <StatCard
                            icon={Wrench}
                            label="Tools Enabled"
                            value={agent.enabledTools.length}
                            accentClass="bg-blue-500/80"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
