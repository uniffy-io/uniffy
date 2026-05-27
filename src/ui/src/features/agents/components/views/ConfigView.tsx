import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
    Key,
    Plus,
    Trash,
    ArrowClockwise,
    CheckCircle,
    XCircle,
    CircleNotch,
    ShieldCheck,
    Eye,
    Brain,
    Wrench,
    LockSimple,
    UsersThree,
    Buildings,
    CaretDown,
    CaretRight,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useAdminAccess } from "@/features/admin";
import { cn } from "@/shared/utils/cn";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
    selectProviderKeys,
    selectAvailableModels,
    selectProvidersLoading,
} from "@/features/agents/store/agentProvidersSlice";
import {
    fetchProviderKeys,
    addProviderKey,
    removeProviderKey,
    validateProviderKey,
    fetchAvailableModels,
    toggleProviderKey,
} from "@/features/agents/store/agentProvidersThunks";
import type { SerializedProviderKey } from "@/features/agents/store/agentProvidersThunks";
import { CredentialType } from "@uniffy/proto/agents/v1/providers_pb";
import { ContentType, AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { useAccessPolicyDialog } from "@/features/permissions";
import { accessModeIcon } from "@/shared/utils/contentRoles";

const PROVIDER_OPTIONS = [
    { value: "anthropic", label: "Anthropic" },
    { value: "openai", label: "OpenAI" },
    { value: "google", label: "Google" },
];

const CREDENTIAL_TYPE_OPTIONS = [
    { value: CredentialType.API_KEY, label: "API Key" },
    { value: CredentialType.SETUP_TOKEN, label: "Setup Token" },
];

interface KeySectionConfig {
    id: "personal" | "shared" | "organization";
    name: string;
    icon: React.ElementType;
}

const SIDEBAR_SECTIONS: KeySectionConfig[] = [
    { id: "personal", name: "My Keys", icon: LockSimple },
    { id: "shared", name: "Shared With Me", icon: UsersThree },
    { id: "organization", name: "Organization", icon: Buildings },
];


function protoTimestampToDateStr(ts?: { seconds: number; nanos: number }): string | undefined {
    if (!ts) return undefined;
    return new Date(ts.seconds * 1000).toISOString();
}

function getCredentialTypeLabel(type: number): string {
    switch (type) {
        case CredentialType.API_KEY:
            return "API Key";
        case CredentialType.SETUP_TOKEN:
            return "Setup Token";
        default:
            return "Unknown";
    }
}

function KeyDetailPanel({
    providerKey,
}: {
    providerKey: SerializedProviderKey;
}) {
    return (
        <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="font-medium text-foreground mb-4">Key Details</h3>
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Provider</span>
                    <span className="text-sm font-medium text-foreground capitalize">
                        {providerKey.provider}
                    </span>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Type</span>
                    <Badge variant="secondary">
                        {getCredentialTypeLabel(providerKey.credentialType)}
                    </Badge>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Hint</span>
                    <span className="text-sm font-mono text-muted-foreground">
                        {providerKey.keyHint || "***"}
                    </span>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <div className="flex items-center gap-1.5">
                        {!providerKey.isEnabled ? (
                            <>
                                <XCircle size={16} weight="fill" className="text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">Disabled</span>
                            </>
                        ) : providerKey.isValid ? (
                            <>
                                <CheckCircle size={16} weight="fill" className="text-green-600 dark:text-green-400" />
                                <span className="text-xs text-green-600 dark:text-green-400">Valid</span>
                            </>
                        ) : (
                            <>
                                <XCircle size={16} weight="fill" className="text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">
                                    {providerKey.lastError || "Not validated"}
                                </span>
                            </>
                        )}
                    </div>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Last Used</span>
                    <span className="text-sm text-muted-foreground">
                        {formatRelativeTime(protoTimestampToDateStr(providerKey.lastUsedAt)) || "Never"}
                    </span>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Last Validated</span>
                    <span className="text-sm text-muted-foreground">
                        {formatRelativeTime(protoTimestampToDateStr(providerKey.lastValidatedAt)) || "Never"}
                    </span>
                </div>
            </div>
        </div>
    );
}

function AddKeyForm({ onSubmit }: { onSubmit: () => void }) {
    const dispatch = useAppDispatch();
    const [provider, setProvider] = useState("anthropic");
    const [credentialType, setCredentialType] = useState<CredentialType>(
        CredentialType.API_KEY,
    );
    const [label, setLabel] = useState("");
    const [credential, setCredential] = useState("");
    const [accessMode, setAccessMode] = useState<number>(AccessMode.OPEN_TO_ORG);
    const [submitting, setSubmitting] = useState(false);

    const canSubmit = provider && label.trim() && credential.trim() && !submitting;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;

        setSubmitting(true);
        try {
            await dispatch(
                addProviderKey({
                    provider,
                    credentialType,
                    label: label.trim(),
                    credential: credential.trim(),
                    accessMode,
                }),
            ).unwrap();
            setLabel("");
            setCredential("");
            onSubmit();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm text-muted-foreground mb-1">
                        Provider
                    </label>
                    <Select
                        value={provider}
                        onChange={setProvider}
                        options={PROVIDER_OPTIONS}
                    />
                </div>
                <div>
                    <label className="block text-sm text-muted-foreground mb-1">
                        Credential Type
                    </label>
                    <Select<number>
                        value={credentialType}
                        onChange={(val) => setCredentialType(val as CredentialType)}
                        options={CREDENTIAL_TYPE_OPTIONS}
                    />
                </div>
            </div>
            <div>
                <label className="block text-sm text-muted-foreground mb-1">
                    Visibility
                </label>
                <div className="space-y-1.5">
                    {([
                        { value: AccessMode.OWNER_ONLY, label: "Private", desc: "Only you can use this key", icon: LockSimple },
                        { value: AccessMode.OPEN_TO_ORG, label: "Organization", desc: "All organization members", icon: Buildings },
                    ] as const).map((opt) => {
                        const Icon = opt.icon;
                        const isActive = accessMode === opt.value;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setAccessMode(opt.value)}
                                className={cn(
                                    "w-full px-3 py-2 rounded-lg border text-left text-sm transition-colors flex items-center gap-3",
                                    isActive
                                        ? "bg-primary/10 border-primary text-foreground"
                                        : "bg-muted border-border text-muted-foreground hover:text-foreground",
                                )}
                            >
                                <Icon size={16} weight={isActive ? "fill" : "regular"} />
                                <div>
                                    <span className="font-medium">{opt.label}</span>
                                    <span className="block text-xs text-muted-foreground">{opt.desc}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
            <div>
                <label className="block text-sm text-muted-foreground mb-1">
                    Label
                </label>
                <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Production API Key"
                />
            </div>
            <div>
                <label className="block text-sm text-muted-foreground mb-1">
                    Credential
                </label>
                <Input
                    type="password"
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                    placeholder="sk-ant-..."
                    className="font-mono"
                />
            </div>
            <div className="flex justify-end">
                <Button type="submit" disabled={!canSubmit}>
                    {submitting ? (
                        <CircleNotch size={16} className="animate-spin" />
                    ) : (
                        <Plus size={16} />
                    )}
                    Add Key
                </Button>
            </div>
        </form>
    );
}

export function ConfigView() {
    const dispatch = useAppDispatch();
    const { openFor: openAccessPolicyDialog } = useAccessPolicyDialog();
    const navigate = useNavigate();
    const { subId } = useParams<{ subId?: string }>();
    const { isOrgAdmin } = useAdminAccess();
    const providerKeysMap = useAppSelector(selectProviderKeys);
    const availableModels = useAppSelector(selectAvailableModels);
    const loading = useAppSelector(selectProvidersLoading);
    const currentUserId = useAppSelector((state) => state.auth.user?.id);

    const selectedKeyId = subId ?? null;
    const selectKey = useCallback(
        (keyId: string | null) => {
            navigate(keyId ? `/agents/config/${keyId}` : "/agents/config", { replace: !keyId });
        },
        [navigate],
    );

    const [validatingKeyId, setValidatingKeyId] = useState<string | null>(null);
    const [togglingKeyId, setTogglingKeyId] = useState<string | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

    const providerKeys = useMemo(
        () => Object.values(providerKeysMap),
        [providerKeysMap],
    );

    const keysBySection = useMemo(() => {
        const result: Record<string, SerializedProviderKey[]> = {
            personal: [],
            shared: [],
            organization: [],
        };
        for (const key of providerKeys) {
            if (key.accessMode === AccessMode.OPEN_TO_ORG) {
                result.organization.push(key);
            } else if (key.createdBy === currentUserId) {
                result.personal.push(key);
            } else {
                result.shared.push(key);
            }
        }
        return result;
    }, [providerKeys, currentUserId]);

    useEffect(() => {
        dispatch(fetchProviderKeys());
        dispatch(fetchAvailableModels());
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const selectedKey = useMemo(
        () => (selectedKeyId ? providerKeysMap[selectedKeyId] ?? null : null),
        [selectedKeyId, providerKeysMap],
    );

    const handleValidate = async (keyId: string) => {
        setValidatingKeyId(keyId);
        try {
            await dispatch(validateProviderKey(keyId)).unwrap();
        } finally {
            setValidatingKeyId(null);
        }
    };

    const handleRemove = async (keyId: string) => {
        await dispatch(removeProviderKey(keyId)).unwrap();
        dispatch(fetchAvailableModels());
        if (selectedKeyId === keyId) {
            selectKey(null);
        }
    };

    const handleToggle = async (keyId: string, enabled: boolean) => {
        setTogglingKeyId(keyId);
        try {
            await dispatch(toggleProviderKey({ keyId, enabled })).unwrap();
            dispatch(fetchAvailableModels());
        } finally {
            setTogglingKeyId(null);
        }
    };

    const handleKeyAdded = (newKeyId?: string) => {
        setShowAddForm(false);
        dispatch(fetchAvailableModels());
        if (newKeyId) {
            selectKey(newKeyId);
        }
    };

    const toggleSection = (sectionId: string) => {
        setCollapsedSections((prev) => ({
            ...prev,
            [sectionId]: !prev[sectionId],
        }));
    };

    const [defaultConfigLayout] = useState(() => loadPanelLayout("agents-config"));

    const handleConfigLayoutChange = useCallback(
        (layout: Record<string, number>) => {
            savePanelLayout("agents-config", layout);
        },
        [],
    );

    if (loading && providerKeys.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <CircleNotch
                    size={32}
                    className="animate-spin text-muted-foreground"
                />
            </div>
        );
    }

    return (
        <div className="flex h-full overflow-hidden">
            <Group
                orientation="horizontal"
                className="h-full w-full flex"
                defaultLayout={defaultConfigLayout}
                onLayoutChange={handleConfigLayoutChange}
            >
            <Panel
                id="config-sidebar"
                defaultSize={260}
                minSize={200}
                maxSize={400}
                className="border-r border-border bg-card overflow-hidden"
            >
            {/* Left sidebar */}
            <div className="h-full flex flex-col">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <span className="font-semibold text-foreground">Provider Keys</span>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => dispatch(fetchProviderKeys())}
                        >
                            <ArrowClockwise size={16} />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={showAddForm ? "text-primary bg-primary/10" : ""}
                            onClick={() => setShowAddForm(!showAddForm)}
                        >
                            <Plus size={16} />
                        </Button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {SIDEBAR_SECTIONS.map((section) => {
                        const sectionKeys = keysBySection[section.id] || [];
                        const isCollapsed = collapsedSections[section.id];
                        const SectionIcon = section.icon;

                        return (
                            <div key={section.id}>
                                <button
                                    type="button"
                                    onClick={() => toggleSection(section.id)}
                                    className="w-full px-4 py-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {isCollapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
                                    <SectionIcon size={14} />
                                    <span className="flex-1 text-left">{section.name}</span>
                                    <span className="text-muted-foreground">{sectionKeys.length}</span>
                                </button>
                                {!isCollapsed && sectionKeys.map((key) => {
                                    const isSelected = key.id === selectedKeyId;
                                    const VisIcon = accessModeIcon(key.accessMode);
                                    return (
                                        <button
                                            key={key.id}
                                            type="button"
                                            onClick={() => {
                                                selectKey(key.id);
                                                setShowAddForm(false);
                                            }}
                                            className={cn(
                                                "w-full px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors text-left",
                                                isSelected
                                                    ? "bg-primary/10 border-l-2 border-primary"
                                                    : "hover:bg-muted border-l-2 border-transparent",
                                            )}
                                        >
                                            <Key size={18} className="text-muted-foreground shrink-0" />
                                            <div className="flex flex-col flex-1 min-w-0">
                                                <span className="text-sm font-medium truncate text-foreground">
                                                    {key.label}
                                                </span>
                                                <span className="text-xs text-muted-foreground capitalize truncate">
                                                    {key.provider} - {key.keyHint || "***"}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                {!key.isEnabled ? (
                                                    <XCircle size={14} className="text-muted-foreground" />
                                                ) : key.isValid ? (
                                                    <CheckCircle size={14} weight="fill" className="text-green-600 dark:text-green-400" />
                                                ) : (
                                                    <XCircle size={14} weight="fill" className="text-muted-foreground" />
                                                )}
                                                <VisIcon size={14} className="text-muted-foreground" />
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>
            </Panel>

            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />

            {/* Right main panel */}
            <Panel id="config-detail" minSize={400}>
            <div className="h-full flex flex-col overflow-hidden">
                {showAddForm ? (
                    <>
                        <div className="px-6 py-4 border-b border-border">
                            <h2 className="text-xl font-semibold text-foreground">
                                Add Provider Key
                            </h2>
                            <p className="text-sm text-muted-foreground">
                                Configure a new LLM provider credential
                            </p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6">
                            <div className="max-w-xl">
                                <AddKeyForm onSubmit={handleKeyAdded} />
                            </div>
                        </div>
                    </>
                ) : selectedKey ? (
                    <>
                        <div className="px-6 py-4 border-b border-border">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                    <Key size={20} className="text-muted-foreground" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h2 className="text-xl font-semibold text-foreground">
                                        {selectedKey.label}
                                    </h2>
                                    <p className="text-sm text-muted-foreground capitalize truncate">
                                        {selectedKey.provider} - {getCredentialTypeLabel(selectedKey.credentialType)}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1">
                                    {(isOrgAdmin || selectedKey.createdBy === currentUserId) && (
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={selectedKey.isEnabled}
                                            aria-label={selectedKey.isEnabled ? "Disable key" : "Enable key"}
                                            disabled={togglingKeyId === selectedKey.id}
                                            onClick={() => handleToggle(selectedKey.id, !selectedKey.isEnabled)}
                                            className={cn(
                                                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors mr-2",
                                                selectedKey.isEnabled ? "bg-primary" : "bg-muted-foreground/30",
                                                togglingKeyId === selectedKey.id && "opacity-50 cursor-not-allowed",
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                                                    selectedKey.isEnabled ? "translate-x-6" : "translate-x-1",
                                                )}
                                            />
                                        </button>
                                    )}
                                    {selectedKey.accessMode === AccessMode.OWNER_ONLY &&
                                        selectedKey.createdBy === currentUserId && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => openAccessPolicyDialog(
                                                ContentType.PROVIDER_KEY,
                                                selectedKey.id,
                                                selectedKey.label,
                                            )}
                                            title="Share"
                                        >
                                            <UsersThree size={18} />
                                        </Button>
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleValidate(selectedKey.id)}
                                        disabled={validatingKeyId === selectedKey.id}
                                        aria-label="Validate key"
                                        title="Validate"
                                    >
                                        {validatingKeyId === selectedKey.id ? (
                                            <CircleNotch size={18} className="animate-spin" />
                                        ) : (
                                            <ShieldCheck size={18} />
                                        )}
                                    </Button>
                                    {(isOrgAdmin || selectedKey.createdBy === currentUserId) && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleRemove(selectedKey.id)}
                                            aria-label="Remove key"
                                            title="Remove"
                                            className="text-muted-foreground hover:text-red-500"
                                        >
                                            <Trash size={18} />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                            <KeyDetailPanel providerKey={selectedKey} />

                            {/* Available Models Section */}
                            <div className="bg-card border border-border rounded-lg overflow-hidden">
                                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Brain size={18} className="text-muted-foreground" />
                                        <span className="font-medium text-foreground">
                                            Available Models (All Keys)
                                        </span>
                                        <Badge variant="secondary">
                                            {availableModels.length}
                                        </Badge>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => dispatch(fetchAvailableModels({ forceRefresh: true }))}
                                        aria-label="Refresh models"
                                    >
                                        <ArrowClockwise size={16} />
                                    </Button>
                                </div>

                                {availableModels.length > 0 ? (
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-4">
                                        {availableModels.map((model) => (
                                            <div
                                                key={model.id}
                                                className="bg-muted/30 border border-border rounded-lg p-3"
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-foreground truncate">
                                                            {model.displayName}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground font-mono truncate">
                                                            {model.id}
                                                        </p>
                                                    </div>
                                                    <Badge variant="secondary" className="capitalize shrink-0">
                                                        {model.provider}
                                                    </Badge>
                                                </div>
                                                <div className="flex items-center gap-3 mt-2">
                                                    <span className="text-xs text-muted-foreground">
                                                        {(model.contextWindow / 1000).toFixed(0)}k ctx
                                                    </span>
                                                    <div className="flex items-center gap-1.5">
                                                        {model.supportsTools && (
                                                            <span title="Supports tools">
                                                                <Wrench size={12} className="text-muted-foreground" />
                                                            </span>
                                                        )}
                                                        {model.supportsVision && (
                                                            <span title="Supports vision">
                                                                <Eye size={12} className="text-muted-foreground" />
                                                            </span>
                                                        )}
                                                        {model.supportsThinking && (
                                                            <span title="Supports thinking">
                                                                <Brain size={12} className="text-muted-foreground" />
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-12">
                                        <Brain size={32} className="text-muted-foreground mb-2" />
                                        <p className="text-sm text-muted-foreground">
                                            No models available
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Add a valid provider key to see available models
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                            <Key size={32} className="text-muted-foreground mx-auto mb-2" />
                            <p className="text-muted-foreground">
                                {providerKeys.length > 0
                                    ? "Select a key from the sidebar"
                                    : "No provider keys configured"}
                            </p>
                            {providerKeys.length === 0 && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="mt-3"
                                    onClick={() => setShowAddForm(true)}
                                >
                                    <Plus size={14} />
                                    Add Key
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </div>
            </Panel>
            </Group>
        </div>
    );
}
