import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
    ArrowRight,
    CaretDown,
    CaretRight,
    Key,
    Sparkle,
    X,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import {
    selectProviderKeys,
    selectModelsByProvider,
    selectModelsForKey,
    selectModelsLoadingForKey,
    selectUsableProviderKeys,
} from "@/features/agents/store/agentProvidersSlice";
import { fetchModelsForKey } from "@/features/agents/store/agentProvidersThunks";
import { updateAgent, uploadAgentAvatar, deleteAgentAvatar } from "@/features/agents/store/agentsThunks";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import { TagPicker } from "@/features/tags";
import { AvatarUpload } from "@/components/ui/avatar-upload";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select, type SelectOption } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { ModelParamsSection } from "@/features/agents/components/ModelParamsSection";
import { ImageCostHint } from "@/features/agents/components/ImageCostHint";
import { parseImagePriceEstimates } from "@/features/agents/utils/imageParams";
import { IMAGE_GENERATION_TOOL } from "@/features/agents/config/toolCatalog";
import { ProviderLogo } from "@/features/agents/components/ProviderLogo";
import {
    parseModelParamsSchema,
    parseModelParamValues,
    stripInvalidParams,
    type ModelParamValues,
} from "@/features/agents/utils/modelParamsSchema";
import { useAgentsBuilderAccess } from "@/features/agents/hooks/useAgentsBuilderAccess";
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
    const location = useLocation();
    const providerKeys = useAppSelector(selectProviderKeys);
    const modelsByProvider = useAppSelector(selectModelsByProvider);
    const { isOrgAdmin } = useAgentsBuilderAccess();

    const myRole = useMyContentRole(ContentType.AGENT, agent.id, agent.userRole);
    // A deleted agent is a historical record: readable, never editable.
    const canEdit = roleCanEdit(myRole) && !agent.isDeleted;

    // Read once: the effect below strips the history entry, and the guidance has
    // to outlive that so it does not vanish on the next render.
    const [arrivedFromCreate] = useState(
        () => (location.state as { needsModelSetup?: boolean } | null)?.needsModelSetup === true,
    );
    const [modelSettingsOpen, setModelSettingsOpen] = useState(arrivedFromCreate);
    const modelSectionRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (!arrivedFromCreate) return;
        navigate(location.pathname, { replace: true, state: null });
        modelSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one shot on arrival; navigate() here would otherwise loop
    }, []);

    // Pinned to the agent we landed on: this component stays mounted while the
    // sidebar switches agents, and the guidance must not follow along.
    const [createdAgentId] = useState(() => (arrivedFromCreate ? agent.id : null));
    const [setupDismissed, setSetupDismissed] = useState(false);

    const primaryKeyId = agent.primaryProviderKeyId || "";
    const imageKeyId = agent.imageProviderKeyId || "";

    const primaryKeyModels = useAppSelector(selectModelsForKey(primaryKeyId));
    const imageKeyModels = useAppSelector(selectModelsForKey(imageKeyId));
    const primaryModelsLoading = useAppSelector(selectModelsLoadingForKey(primaryKeyId));
    const imageModelsLoading = useAppSelector(selectModelsLoadingForKey(imageKeyId));

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

    const enabledKeys = useAppSelector(selectUsableProviderKeys);

    const allKeys = useMemo(() => Object.values(providerKeys), [providerKeys]);
    const hasAnyKeys = allKeys.length > 0;

    const keyChoices = useMemo(
        () =>
            enabledKeys.map((k) => ({
                value: k.id,
                label: `${k.label} (${k.provider})`,
                icon: <ProviderLogo provider={k.provider} size="sm" />,
            })),
        [enabledKeys],
    );

    // An unset key/model means the backend resolves the org default at run
    // time; members cannot read which model that is, so the label stays generic.
    const chatKeyOptions: SelectOption<string>[] = useMemo(
        () => [{ value: "", label: "Organization default" }, ...keyChoices],
        [keyChoices],
    );

    // Catalog-derived, so this costs no extra request: providers whose catalog
    // carries at least one image model.
    const imageCapableProviders = useMemo(() => {
        const providers = new Set<string>();
        for (const [provider, models] of Object.entries(modelsByProvider)) {
            if (models.some((m) => m.supportsImageGeneration)) {
                providers.add(provider);
            }
        }
        return providers;
    }, [modelsByProvider]);

    // Offering a text-only key here just leads to an empty model list. The
    // already-assigned key stays listed so an existing config is never dropped
    // silently, and an unloaded catalog falls back to showing everything rather
    // than hiding keys that are actually fine.
    const imageKeyOptions: SelectOption<string>[] = useMemo(() => {
        const catalogKnown = imageCapableProviders.size > 0;
        const choices = enabledKeys
            .filter(
                (k) =>
                    !catalogKnown || imageCapableProviders.has(k.provider) || k.id === imageKeyId,
            )
            .map((k) => ({
                value: k.id,
                label: `${k.label} (${k.provider})`,
                icon: <ProviderLogo provider={k.provider} size="sm" />,
            }));
        return [{ value: "", label: "No key assigned" }, ...choices];
    }, [enabledKeys, imageCapableProviders, imageKeyId]);

    // Walk the picker chain forward: a key has to be chosen before its model
    // list exists, so only one control is ever ringed at a time per column.
    const wantsImageModel = agent.enabledTools.includes(IMAGE_GENERATION_TOOL);
    // Nothing to point at when the org holds no image-capable key.
    const canPickImageModel = imageKeyOptions.length > 1;
    const guideImage = wantsImageModel && canPickImageModel;
    const guiding = createdAgentId === agent.id && !setupDismissed && hasAnyKeys;
    const needsChatKey = guiding && !primaryKeyId;
    const needsChatModel = guiding && !!primaryKeyId && !agent.primaryModel;
    const needsImageKey = guiding && guideImage && !imageKeyId;
    const needsImageModel = guiding && guideImage && !!imageKeyId && !agent.imageModel;
    const guidanceActive = needsChatKey || needsChatModel || needsImageKey || needsImageModel;

    const attentionRing = (active: boolean) => (active ? "uniffy-attention-ring" : undefined);

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

    const imageParamValues = useMemo(
        () => parseModelParamValues(agent.imageParams),
        [agent.imageParams],
    );

    const imageModelSchemaJson = useMemo(
        () =>
            imageKeyModels.find((m) => m.id === agent.imageModel)?.imageParameterSchemaJson ?? "",
        [imageKeyModels, agent.imageModel],
    );

    const imagePriceEstimates = useMemo(
        () => parseImagePriceEstimates(
            imageKeyModels.find((m) => m.id === agent.imageModel)?.imagePriceEstimatesJson ?? "",
        ),
        [imageKeyModels, agent.imageModel],
    );

    const handleImageModelChange = (value: string) => {
        const fields: { imageModel: string; imageParams?: string } = { imageModel: value };
        if (Object.keys(imageParamValues).length > 0) {
            const nextSchema = parseModelParamsSchema(
                imageKeyModels.find((m) => m.id === value)?.imageParameterSchemaJson ?? "",
            );
            fields.imageParams = JSON.stringify(stripInvalidParams(nextSchema, imageParamValues));
        }
        handleUpdate(fields);
    };

    const handleImageParamsChange = (next: ModelParamValues) => {
        handleUpdate({ imageParams: JSON.stringify(next) });
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

    // Buffered like the name field: a per-keystroke update RPC round-trips the
    // stored value back over the input and eats characters.
    const [styleState, setStyleState] = useState({
        id: agent.id,
        value: agent.imageStylePrompt,
    });
    if (styleState.id !== agent.id) {
        setStyleState({ id: agent.id, value: agent.imageStylePrompt });
    }
    const styleChanged = styleState.value !== agent.imageStylePrompt;

    const handleSaveStylePrompt = () => {
        if (styleChanged) handleUpdate({ imageStylePrompt: styleState.value });
    };

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
            <section className="py-6" ref={modelSectionRef}>
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
                {guidanceActive && modelSettingsOpen && (
                    <div
                        className="mt-4 flex items-start gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 animate-in fade-in slide-in-from-top-1 duration-500"
                        data-testid="agent-model-setup-hint"
                    >
                        <Sparkle size={16} weight="fill" className="mt-0.5 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground">
                                Pick a model to finish setting up {agent.name}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                {guideImage
                                    ? "Choose a provider key and chat model. This agent can also generate images, so give it an image model too."
                                    : "Choose a provider key, then the chat model this agent runs on."}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setSetupDismissed(true)}
                            title="Dismiss"
                            aria-label="Dismiss model setup hint"
                            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                            data-testid="agent-model-setup-hint-dismiss"
                        >
                            <X size={14} />
                        </button>
                    </div>
                )}
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
                                {!isOrgAdmin && " Only an organization admin can add one."}
                            </p>
                            {isOrgAdmin && (
                                <Button
                                    size="md"
                                    onClick={() => navigate("/admin/agents?tab=keys")}
                                >
                                    <Key size={16} weight="bold" />
                                    Add Provider Key
                                    <ArrowRight size={14} />
                                </Button>
                            )}
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
                                            triggerClassName={attentionRing(needsChatKey)}
                                        />
                                    </div>
                                    <div>
                                        <FieldLabel>Model</FieldLabel>
                                        <Select
                                            value={agent.primaryModel}
                                            onChange={handlePrimaryModelChange}
                                            options={primaryModelOptions}
                                            placeholder={
                                                !primaryKeyId
                                                    ? "Select a provider key first"
                                                    : primaryModelsLoading
                                                        ? "Loading models..."
                                                        : "Select model..."
                                            }
                                            disabled={!canEdit || !primaryKeyId}
                                            className="w-full"
                                            triggerClassName={attentionRing(needsChatModel)}
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
                                            triggerClassName={attentionRing(needsImageKey)}
                                        />
                                    </div>
                                    <div>
                                        <FieldLabel>Model</FieldLabel>
                                        <Select
                                            value={agent.imageModel}
                                            onChange={handleImageModelChange}
                                            options={imageModelOptions}
                                            placeholder={
                                                !imageKeyId
                                                    ? "Select a provider key first"
                                                    : imageModelsLoading
                                                        ? "Loading models..."
                                                        : "Select model..."
                                            }
                                            disabled={!canEdit || !imageKeyId}
                                            className="w-full"
                                            triggerClassName={attentionRing(needsImageModel)}
                                        />
                                        <p className="text-xs text-muted-foreground mt-1.5">
                                            {!canPickImageModel
                                                ? "No organization key has an image model available"
                                                : wantsImageModel
                                                    ? "This agent has the image generation tool enabled"
                                                    : "Used for the image generation tool"}
                                        </p>
                                    </div>
                                    {agent.imageModel && (
                                        <>
                                            <ModelParamsSection
                                                title="Image Defaults"
                                                schemaJson={imageModelSchemaJson}
                                                values={imageParamValues}
                                                onChange={handleImageParamsChange}
                                                disabled={!canEdit}
                                                renderRowSuffix={(key) =>
                                                    key === "resolution" || key === "quality" ? (
                                                        <ImageCostHint
                                                            estimates={imagePriceEstimates}
                                                            values={imageParamValues}
                                                        />
                                                    ) : null
                                                }
                                            />
                                            <div>
                                                <FieldLabel>Style Preset</FieldLabel>
                                                <textarea
                                                    value={styleState.value}
                                                    onChange={(e) =>
                                                        setStyleState({
                                                            id: agent.id,
                                                            value: e.target.value,
                                                        })
                                                    }
                                                    onBlur={handleSaveStylePrompt}
                                                    rows={3}
                                                    disabled={!canEdit}
                                                    placeholder="e.g. flat vector illustration, muted palette, no text"
                                                    className={cn(
                                                        "w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground",
                                                        "focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring transition-all",
                                                        "placeholder:text-muted-foreground resize-y",
                                                        !canEdit && "opacity-50 cursor-not-allowed",
                                                    )}
                                                />
                                                <div className="mt-1.5 flex items-start justify-between gap-3">
                                                    <p className="text-xs text-muted-foreground">
                                                        Appended to every image prompt. Providers dropped
                                                        their style parameter, so house style lives here.
                                                    </p>
                                                    {styleChanged && (
                                                        <Button size="sm" onClick={handleSaveStylePrompt}>
                                                            Save
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        </>
                                    )}
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
