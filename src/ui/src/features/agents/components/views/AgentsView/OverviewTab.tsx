import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
    ArrowRight,
    CaretDown,
    CaretRight,
    Key,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { selectProviderKeys, selectModelsForKey } from "@/features/agents/store/agentProvidersSlice";
import { fetchModelsForKey } from "@/features/agents/store/agentProvidersThunks";
import { updateAgent, uploadAgentAvatar, deleteAgentAvatar } from "@/features/agents/store/agentsThunks";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import { TagPicker } from "@/features/tags";
import { AvatarUpload } from "@/components/ui/avatar-upload";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select, type SelectOption } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { ModelParamsSection } from "@/features/agents/components/ModelParamsSection";
import {
    parseModelParamsSchema,
    parseModelParamValues,
    stripInvalidParams,
    type ModelParamValues,
} from "@/features/agents/utils/modelParamsSchema";
import { useMyContentRole } from "@/features/permissions";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { roleCanEdit } from "@/shared/utils/contentRoles";

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
            {children}
        </h3>
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

    const myRole = useMyContentRole(ContentType.AGENT, agent.id, agent.userRole);
    const canEdit = roleCanEdit(myRole);

    const [modelSettingsOpen, setModelSettingsOpen] = useState(false);

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

    const keyChoices = useMemo(
        () =>
            enabledKeys.map((k) => ({
                value: k.id,
                label: `${k.label} (${k.provider})`,
            })),
        [enabledKeys],
    );

    // An unset key/model means the backend resolves the org default at run
    // time; members cannot read which model that is, so the label stays generic.
    const chatKeyOptions: SelectOption<string>[] = useMemo(
        () => [{ value: "", label: "Organization default" }, ...keyChoices],
        [keyChoices],
    );

    const imageKeyOptions: SelectOption<string>[] = useMemo(
        () => [{ value: "", label: "No key assigned" }, ...keyChoices],
        [keyChoices],
    );

    // Only curated catalog chat models are selectable - keeps live-API noise
    // (whisper, realtime, embeddings, image-only) out of the chat pickers.
    const chatModels = useMemo(
        () => primaryKeyModels.filter((m) => m.catalogKnown && !m.supportsImageGeneration),
        [primaryKeyModels],
    );

    const primaryModelOptions: SelectOption<string>[] = useMemo(() => {
        const opts = chatModels.map((m) => ({
            value: m.id,
            label: `${m.displayName}`,
        }));
        if (agent.primaryModel && !chatModels.some((m) => m.id === agent.primaryModel)) {
            opts.unshift({ value: agent.primaryModel, label: agent.primaryModel });
        }
        opts.unshift({ value: "", label: "Organization default" });
        return opts;
    }, [chatModels, agent.primaryModel]);

    const imageModelOptions: SelectOption<string>[] = useMemo(() => {
        const opts: SelectOption<string>[] = [
            { value: "", label: "Disabled" },
            ...imageKeyModels
                .filter((m) => m.supportsImageGeneration)
                .map((m) => ({ value: m.id, label: m.displayName })),
        ];
        // Keep an already-configured model visible even if it is no longer
        // advertised as image-capable (e.g. a key/catalog change).
        if (agent.imageModel && !opts.some((o) => o.value === agent.imageModel)) {
            opts.push({ value: agent.imageModel, label: agent.imageModel });
        }
        return opts;
    }, [imageKeyModels, agent.imageModel]);

    const fallbackModelOptions = useMemo(
        () =>
            chatModels
                .filter((m) => m.id !== agent.primaryModel)
                .map((m) => ({ value: m.id, label: `${m.displayName}` })),
        [chatModels, agent.primaryModel],
    );

    const handleUpdate = (fields: Omit<Parameters<typeof updateAgent>[0], 'agentId'>) => {
        dispatch(updateAgent({ agentId: agent.id, ...fields }));
    };

    const modelParamValues = useMemo(
        () => parseModelParamValues(agent.modelParams),
        [agent.modelParams],
    );

    const primaryModelSchemaJson = useMemo(
        () => primaryKeyModels.find((m) => m.id === agent.primaryModel)?.parameterSchemaJson ?? "",
        [primaryKeyModels, agent.primaryModel],
    );

    const handlePrimaryModelChange = (value: string) => {
        const fields: { primaryModel: string; modelParams?: string } = { primaryModel: value };
        if (Object.keys(modelParamValues).length > 0) {
            const nextSchema = parseModelParamsSchema(
                primaryKeyModels.find((m) => m.id === value)?.parameterSchemaJson ?? "",
            );
            fields.modelParams = JSON.stringify(stripInvalidParams(nextSchema, modelParamValues));
        }
        handleUpdate(fields);
    };

    const handleModelParamsChange = (next: ModelParamValues) => {
        handleUpdate({ modelParams: JSON.stringify(next) });
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
        <div className="max-w-4xl mx-auto divide-y divide-border animate-in fade-in duration-300">
            <section className="pb-6 space-y-4">
                <SectionLabel>Identity</SectionLabel>
                <div className="flex items-start gap-6">
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

                    <div className="flex-1 min-w-0 space-y-4">
                        <div>
                            <FieldLabel>Name</FieldLabel>
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
                        <div>
                            <FieldLabel>Tags</FieldLabel>
                            <TagPicker
                                selectedTagIds={agent.tagIds ?? []}
                                onChange={(ids) => handleUpdate({ tagIds: ids })}
                                disabled={!canEdit}
                                placeholder="Add a tag"
                            />
                        </div>
                        <div className="flex items-end gap-4">
                            <div>
                                <FieldLabel>Fallback Emoji</FieldLabel>
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
            </section>

            {canEdit && (
            <section className="py-6">
                <button
                    type="button"
                    onClick={() => setModelSettingsOpen(!modelSettingsOpen)}
                    className="w-full flex items-center justify-between gap-3 text-left cursor-pointer"
                    data-testid="agent-model-settings-toggle"
                    data-state={modelSettingsOpen ? "open" : "closed"}
                >
                    <div>
                        <SectionLabel>Model settings</SectionLabel>
                        <p className="text-sm text-muted-foreground mt-1">
                            Configure the LLM providers and models this agent uses
                        </p>
                    </div>
                    {modelSettingsOpen ? (
                        <CaretDown size={16} className="text-muted-foreground shrink-0" />
                    ) : (
                        <CaretRight size={16} className="text-muted-foreground shrink-0" />
                    )}
                </button>
                {modelSettingsOpen && (
                <div className="mt-5">
                    {!hasAnyKeys ? (
                        <div className="border border-dashed border-border rounded-lg p-8 text-center">
                            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
                                <Key size={24} className="text-primary" />
                            </div>
                            <h4 className="text-sm font-medium text-foreground mb-1.5">
                                No provider keys configured
                            </h4>
                            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-5">
                                Add a provider API key to start using this agent.
                                Organization keys and defaults are managed on the
                                admin agents page.
                            </p>
                            <Button
                                size="md"
                                onClick={() => navigate("/admin/agents")}
                            >
                                <Key size={16} weight="bold" />
                                Add Provider Key
                                <ArrowRight size={14} />
                            </Button>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <SectionLabel>Chat Model</SectionLabel>
                                    <div>
                                        <FieldLabel>Provider Key</FieldLabel>
                                        <Select
                                            value={primaryKeyId}
                                            onChange={(value) => handleUpdate({
                                                primaryProviderKeyId: value,
                                            })}
                                            options={chatKeyOptions}
                                            placeholder="Select provider key..."
                                            disabled={!canEdit}
                                            className="w-full"
                                        />
                                    </div>
                                    <div>
                                        <FieldLabel>Model</FieldLabel>
                                        <Select
                                            value={agent.primaryModel}
                                            onChange={handlePrimaryModelChange}
                                            options={primaryModelOptions}
                                            placeholder={primaryKeyId ? "Select model..." : "Select a provider key first"}
                                            disabled={!canEdit || !primaryKeyId}
                                            className="w-full"
                                        />
                                    </div>
                                    <ModelParamsSection
                                        schemaJson={primaryModelSchemaJson}
                                        values={modelParamValues}
                                        onChange={handleModelParamsChange}
                                        disabled={!canEdit}
                                    />
                                </div>

                                <div className="space-y-4">
                                    <SectionLabel>Image Model</SectionLabel>
                                    <div>
                                        <FieldLabel>Provider Key</FieldLabel>
                                        <Select
                                            value={imageKeyId}
                                            onChange={(value) => handleUpdate({
                                                imageProviderKeyId: value,
                                            })}
                                            options={imageKeyOptions}
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

                            <div className="mt-8 space-y-3">
                                <SectionLabel>Fallback Models</SectionLabel>
                                <MultiSelect
                                    value={agent.fallbackModels}
                                    onChange={(models) => handleUpdate({ fallbackModels: models })}
                                    options={fallbackModelOptions}
                                    placeholder={primaryKeyId ? "Select fallback models..." : "Select a primary key first"}
                                    disabled={!canEdit || !primaryKeyId}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Used automatically when the primary chat model is unavailable
                                </p>
                            </div>
                        </>
                    )}
                </div>
                )}
            </section>
            )}

            <section className="py-6 space-y-3">
                <SectionLabel>Agent Settings</SectionLabel>
                <div className="flex items-center justify-between gap-4 py-2 border-b border-border/60">
                    <div className="min-w-0">
                        <span className="text-sm font-medium text-foreground">
                            Default Agent
                        </span>
                        <p className="text-xs text-muted-foreground">
                            Used when creating new sessions without specifying an agent
                        </p>
                    </div>
                    <ToggleSwitch
                        size="sm"
                        enabled={agent.isDefault}
                        disabled={!canEdit}
                        onChange={() => handleUpdate({ isDefault: !agent.isDefault })}
                    />
                </div>
                <div className="flex items-center justify-between py-2 border-b border-border/60 text-sm">
                    <span className="text-foreground">Skills Enabled</span>
                    <span className="text-muted-foreground tabular-nums">
                        {agent.enabledSkills.length}
                    </span>
                </div>
                <div className="flex items-center justify-between py-2 text-sm">
                    <span className="text-foreground">Tools Enabled</span>
                    <span className="text-muted-foreground tabular-nums">
                        {agent.enabledTools.length}
                    </span>
                </div>
            </section>
        </div>
    );
}
