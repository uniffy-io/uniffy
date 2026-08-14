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
  Warning,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  selectProviderKeys,
  selectAvailableModels,
  selectModelsForKey,
  selectProvidersLoading,
} from "@/features/agents/store/agentProvidersSlice";
import {
  fetchProviderKeys,
  addProviderKey,
  removeProviderKey,
  validateProviderKey,
  fetchAvailableModels,
  fetchModelsForKey,
  toggleProviderKey,
} from "@/features/agents/store/agentProvidersThunks";
import type { SerializedProviderKey } from "@/features/agents/store/agentProvidersThunks";
import { ProviderLogo } from "@/features/agents/components/ProviderLogo";
import { ProviderPicker } from "@/features/agents/components/ProviderPicker";
import { providerBrand, providerLabel } from "@/features/agents/config/providerBrands";

const CREDENTIAL_WRITE_ONCE_NOTE =
  "Pasted once and encrypted at rest. It is never shown again, so keep your own copy.";

/** "1M ctx" at >= 1M tokens, "200k ctx" below. */
function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${Number((tokens / 1_000_000).toFixed(1))}M`;
  }
  return `${Math.round(tokens / 1000)}k`;
}

function protoTimestampToDateStr(ts?: { seconds: number; nanos: number }): string | undefined {
  if (!ts) return undefined;
  return new Date(ts.seconds * 1000).toISOString();
}

function KeyDetailPanel({ providerKey }: { providerKey: SerializedProviderKey }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="font-medium text-foreground mb-4">Key Details</h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Provider</span>
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <ProviderLogo provider={providerKey.provider} size="sm" />
            {providerLabel(providerKey.provider)}
          </span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="text-sm text-muted-foreground">Hint</span>
            <span className="block text-xs text-muted-foreground">
              The full credential is write-once and cannot be read back.
            </span>
          </div>
          <span className="text-sm font-mono text-muted-foreground shrink-0">
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
                <CheckCircle
                  size={16}
                  weight="fill"
                  className="text-green-600 dark:text-green-400"
                />
                <span className="text-xs text-green-600 dark:text-green-400">Valid</span>
              </>
            ) : (
              <>
                <XCircle size={16} weight="fill" className="text-red-600 dark:text-red-400" />
                <span className="text-xs text-red-600 dark:text-red-400">Rejected by provider</span>
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
        {!providerKey.isValid && providerKey.lastError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-100 dark:bg-red-900/30 p-3">
            <XCircle
              size={16}
              weight="fill"
              className="text-red-600 dark:text-red-400 shrink-0 mt-0.5"
            />
            <p className="text-xs text-red-800 dark:text-red-400 break-words">
              {providerKey.lastError}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function AddKeyForm({ onSubmit }: { onSubmit: (keyId: string) => void }) {
  const dispatch = useAppDispatch();
  const [provider, setProvider] = useState("anthropic");
  const [label, setLabel] = useState("");
  const [credential, setCredential] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = provider && label.trim() && credential.trim() && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      // The credential is only judged by the provider probe the backend
      // runs on save; a rejected key still lands, with the error on it.
      const key = await dispatch(
        addProviderKey({
          provider,
          label: label.trim(),
          credential: credential.trim(),
        }),
      ).unwrap();
      setLabel("");
      setCredential("");
      onSubmit(key.id);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm text-muted-foreground mb-1.5">Provider</label>
        <ProviderPicker value={provider} onChange={setProvider} />
      </div>
      <div>
        <label className="block text-sm text-muted-foreground mb-1">Label</label>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Production API Key"
        />
      </div>
      <div>
        <label className="block text-sm text-muted-foreground mb-1">API Key</label>
        <Input
          type="password"
          value={credential}
          onChange={(e) => setCredential(e.target.value)}
          placeholder={providerBrand(provider)?.credentialPlaceholder ?? "API key"}
          className="font-mono"
        />
        <div className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Warning size={14} className="shrink-0 mt-0.5" />
          <span>{CREDENTIAL_WRITE_ONCE_NOTE}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          On save we call the provider to list its models. A key that fails that call is stored with
          the error shown on the key.
        </p>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? <CircleNotch size={16} className="animate-spin" /> : <Plus size={16} />}
          Add Key
        </Button>
      </div>
    </form>
  );
}

interface ConfigViewProps {
  // When embedded (admin surface), selection lives in local state
  // instead of the /agents/config URL so the component can render off-route.
  embedded?: boolean;
}

export function ConfigView({ embedded = false }: ConfigViewProps = {}) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { subId } = useParams<{ subId?: string }>();
  const providerKeysMap = useAppSelector(selectProviderKeys);
  const availableModels = useAppSelector(selectAvailableModels);
  const loading = useAppSelector(selectProvidersLoading);

  const [localKeyId, setLocalKeyId] = useState<string | null>(null);
  const selectedKeyId = embedded ? localKeyId : (subId ?? null);
  const selectKey = useCallback(
    (keyId: string | null) => {
      if (embedded) {
        setLocalKeyId(keyId);
        return;
      }
      navigate(keyId ? `/agents/config/${keyId}` : "/agents/config", { replace: !keyId });
    },
    [embedded, navigate],
  );

  const [validatingKeyId, setValidatingKeyId] = useState<string | null>(null);
  const [togglingKeyId, setTogglingKeyId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [modelsTab, setModelsTab] = useState<"key" | "all">("key");

  const providerKeys = useMemo(() => Object.values(providerKeysMap), [providerKeysMap]);

  useEffect(() => {
    dispatch(fetchProviderKeys());
    dispatch(fetchAvailableModels());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedKey = useMemo(
    () => (selectedKeyId ? (providerKeysMap[selectedKeyId] ?? null) : null),
    [selectedKeyId, providerKeysMap],
  );

  const keyModels = useAppSelector(selectModelsForKey(selectedKeyId ?? ""));
  const shownModels = modelsTab === "all" ? availableModels : keyModels;

  useEffect(() => {
    if (selectedKeyId) {
      dispatch(fetchModelsForKey({ keyId: selectedKeyId }));
    }
  }, [selectedKeyId, dispatch]);

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

  const handleKeyAdded = (newKeyId: string) => {
    setShowAddForm(false);
    dispatch(fetchAvailableModels());
    selectKey(newKeyId);
  };

  const [defaultConfigLayout] = useState(() => loadPanelLayout("agents-config"));

  const handleConfigLayoutChange = useCallback((layout: Record<string, number>) => {
    savePanelLayout("agents-config", layout);
  }, []);

  if (loading && providerKeys.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <CircleNotch size={32} className="animate-spin text-muted-foreground" />
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
                  onClick={() => dispatch(fetchProviderKeys({ force: true }))}
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
              {providerKeys.map((key) => {
                const isSelected = key.id === selectedKeyId;
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
                    {providerBrand(key.provider) ? (
                      <ProviderLogo provider={key.provider} size="lg" />
                    ) : (
                      <Key size={18} className="text-muted-foreground shrink-0" />
                    )}
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="text-sm font-medium truncate text-foreground">
                        {key.label}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {providerLabel(key.provider)} - {key.keyHint || "***"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!key.isEnabled ? (
                        <XCircle size={14} className="text-muted-foreground" />
                      ) : key.isValid ? (
                        <CheckCircle
                          size={14}
                          weight="fill"
                          className="text-green-600 dark:text-green-400"
                        />
                      ) : (
                        <XCircle size={14} weight="fill" className="text-muted-foreground" />
                      )}
                    </div>
                  </button>
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
                  <h2 className="text-xl font-semibold text-foreground">Add Provider Key</h2>
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
                      {providerBrand(selectedKey.provider) ? (
                        <ProviderLogo provider={selectedKey.provider} size="lg" />
                      ) : (
                        <Key size={20} className="text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl font-semibold text-foreground">{selectedKey.label}</h2>
                      <p className="text-sm text-muted-foreground truncate">
                        {providerLabel(selectedKey.provider)} - {selectedKey.keyHint || "***"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="mr-2">
                        <ToggleSwitch
                          enabled={selectedKey.isEnabled}
                          disabled={togglingKeyId === selectedKey.id}
                          onChange={(enabled) => handleToggle(selectedKey.id, enabled)}
                        />
                      </span>
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
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  <KeyDetailPanel providerKey={selectedKey} />

                  {/* Available Models Section */}
                  <div className="bg-card border border-border rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Brain size={18} className="text-muted-foreground shrink-0" />
                        <span className="font-medium text-foreground">Available Models</span>
                        <Badge variant="secondary">{shownModels.length}</Badge>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="inline-flex rounded-md border border-border bg-muted p-0.5">
                          <button
                            type="button"
                            onClick={() => setModelsTab("key")}
                            className={cn(
                              "px-2.5 py-1 text-xs font-medium rounded transition-colors",
                              modelsTab === "key"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            This key
                          </button>
                          <button
                            type="button"
                            onClick={() => setModelsTab("all")}
                            className={cn(
                              "px-2.5 py-1 text-xs font-medium rounded transition-colors",
                              modelsTab === "all"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            All keys
                          </button>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (modelsTab === "all") {
                              dispatch(fetchAvailableModels({ force: true }));
                            } else {
                              dispatch(
                                fetchModelsForKey({
                                  keyId: selectedKey.id,
                                  force: true,
                                }),
                              );
                            }
                          }}
                          aria-label="Refresh models"
                        >
                          <ArrowClockwise size={16} />
                        </Button>
                      </div>
                    </div>

                    {shownModels.length > 0 ? (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-4">
                        {shownModels.map((model) => (
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
                              <Badge
                                variant="secondary"
                                className="flex items-center gap-1.5 shrink-0"
                              >
                                <ProviderLogo provider={model.provider} size="xs" />
                                {providerLabel(model.provider)}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-3 mt-2">
                              <span className="text-xs text-muted-foreground">
                                {formatContextWindow(model.contextWindow)} ctx
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
                        <p className="text-sm text-muted-foreground">No models available</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {modelsTab === "key"
                            ? "This key exposes no models, or it has not been validated yet"
                            : "Add a valid provider key to see available models"}
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
