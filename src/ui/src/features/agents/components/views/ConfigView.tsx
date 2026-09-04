import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Group, Panel } from "react-resizable-panels";
import { PaneSeparator } from "@/components/ui/pane-separator";
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
  MagnifyingGlass,
  ClockCounterClockwise,
  SealCheck,
  Image as ImageIcon,
  Lightning,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { brandGradient, brandRampStops } from "@/config/theme/brandGradients";
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
import type {
  SerializedProviderKey,
  SerializedModelInfo,
} from "@/features/agents/store/agentProvidersThunks";
import { ProviderLogo } from "@/features/agents/components/ProviderLogo";
import { ProviderPicker } from "@/features/agents/components/ProviderPicker";
import { providerBrand, providerLabel } from "@/features/agents/config/providerBrands";
import { formatContextWindow, formatPricePer1M } from "@/features/agents/utils/modelFormatting";
import { summarizeKeyError } from "@/features/agents/utils/providerKeyErrors";

const CREDENTIAL_WRITE_ONCE_NOTE =
  "Pasted once and encrypted at rest. It is never shown again, so keep your own copy.";

const EMPTY_MODELS: SerializedModelInfo[] = [];

interface Capability {
  label: string;
  icon: Icon;
  has: (model: SerializedModelInfo) => boolean;
  /** Slice of the brand axis this marker is painted with, like a tool group. */
  paint: string;
}

const CAPABILITY_ORDER: Omit<Capability, "paint">[] = [
  { label: "Tools", icon: Wrench, has: (m) => m.supportsTools },
  { label: "Vision", icon: Eye, has: (m) => m.supportsVision },
  { label: "Thinking", icon: Brain, has: (m) => m.supportsThinking },
  { label: "Images", icon: ImageIcon, has: (m) => m.supportsImageGeneration },
  { label: "Cache", icon: Lightning, has: (m) => m.supportsPromptCache },
];

// The markers walk the axis end to end the way the catalog's tool groups do, so
// a capability reads the same shade on every card regardless of the user accent.
const CAPABILITIES: Capability[] = CAPABILITY_ORDER.map((capability, index) => ({
  ...capability,
  paint: brandGradient(brandRampStops(index, CAPABILITY_ORDER.length, { shade: 0.22 })),
}));

function protoTimestampToDateStr(ts?: { seconds: number; nanos: number }): string | undefined {
  if (!ts) return undefined;
  return new Date(ts.seconds * 1000).toISOString();
}

type KeyStatus = "disabled" | "valid" | "rejected";

function keyStatus(providerKey: SerializedProviderKey): KeyStatus {
  if (!providerKey.isEnabled) return "disabled";
  return providerKey.isValid ? "valid" : "rejected";
}

const STATUS_LABELS: Record<KeyStatus, string> = {
  disabled: "Disabled",
  valid: "Valid",
  rejected: "Rejected",
};

const STATUS_TEXT: Record<KeyStatus, string> = {
  disabled: "text-muted-foreground",
  valid: "text-green-600 dark:text-green-400",
  rejected: "text-red-600 dark:text-red-400",
};

function StatusIcon({ status, size = 16 }: { status: KeyStatus; size?: number }) {
  if (status === "valid") {
    return <CheckCircle size={size} weight="fill" className={STATUS_TEXT.valid} />;
  }
  return (
    <XCircle
      size={size}
      weight="fill"
      className={status === "rejected" ? STATUS_TEXT.rejected : STATUS_TEXT.disabled}
    />
  );
}

function KeyErrorNotice({ lastError, provider }: { lastError?: string; provider: string }) {
  const [showDetail, setShowDetail] = useState(false);
  const { headline, detail } = summarizeKeyError(lastError, provider);

  return (
    <div className="rounded-lg border border-red-500/40 bg-red-100 p-3 dark:bg-red-900/30">
      <div className="flex items-start gap-2">
        <XCircle
          size={16}
          weight="fill"
          className="mt-0.5 shrink-0 text-red-600 dark:text-red-400"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-red-800 dark:text-red-400">{headline}</p>
          {detail && (
            <button
              type="button"
              onClick={() => setShowDetail((open) => !open)}
              className="mt-1 text-xs font-medium text-red-800/80 underline underline-offset-2 hover:text-red-800 dark:text-red-400/80 dark:hover:text-red-400"
            >
              {showDetail ? "Hide provider response" : "Show provider response"}
            </button>
          )}
          {showDetail && detail && (
            <p className="mt-2 break-words font-mono text-[11px] leading-relaxed text-red-800/90 dark:text-red-400/90">
              {detail}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaFact({ icon: FactIcon, label, value }: { icon: Icon; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={label}>
      <FactIcon size={13} className="shrink-0" />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}

function PriceCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "truncate text-sm font-semibold tabular-nums",
          value ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {value ?? "n/a"}
      </p>
    </div>
  );
}

function ModelCard({ model }: { model: SerializedModelInfo }) {
  const input = formatPricePer1M(model.inputPer1m);
  const output = formatPricePer1M(model.outputPer1m);
  const cached = formatPricePer1M(model.cacheReadPer1m);
  const isFree = input === "$0" && output === "$0";
  const priced = input !== null || output !== null;

  return (
    <div
      className="flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-edge"
      data-testid={`provider-model-${model.id}`}
    >
      <div className="flex items-start gap-3">
        {/* No text color here: mono marks are currentColor masks, so a muted
            tone would restyle the trademark (docs/TRADEMARKS.md). */}
        <span
          title={providerLabel(model.provider)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted"
        >
          <ProviderLogo provider={model.provider} size="md" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{model.displayName}</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{model.id}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {CAPABILITIES.map((capability) =>
          capability.has(model) ? (
            <span
              key={capability.label}
              title={capability.label}
              className="flex h-5 w-5 items-center justify-center rounded-md text-white"
              style={{ background: capability.paint }}
            >
              <capability.icon size={11} weight="duotone" />
            </span>
          ) : null,
        )}
        <span className="ml-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
          {formatContextWindow(model.contextWindow)} ctx
        </span>
        {model.deprecated && (
          <Badge
            variant="secondary"
            className="ml-1 bg-amber-100 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
          >
            Deprecated
          </Badge>
        )}
      </div>

      <div className="mt-auto grid grid-cols-3 gap-2 border-t border-border pt-2.5">
        {isFree ? (
          <div className="col-span-3">
            <p className="text-sm font-semibold text-green-600 dark:text-green-400">Free</p>
          </div>
        ) : priced ? (
          <>
            <PriceCell label="In" value={input} />
            <PriceCell label="Out" value={output} />
            <PriceCell label="Cached in" value={cached} />
          </>
        ) : (
          <div className="col-span-3">
            <p className="text-xs text-muted-foreground">
              Rate set by the provider at call time, not the catalog
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
  const [modelSearch, setModelSearch] = useState("");

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
  // Model listing is catalog-only, so it answers for the key's PROVIDER, not
  // the credential. A key the provider refused reaches none of them.
  const tabModels =
    modelsTab === "all" ? availableModels : selectedKey?.isValid ? keyModels : EMPTY_MODELS;
  const shownModels = useMemo(() => {
    const needle = modelSearch.trim().toLowerCase();
    if (!needle) return tabModels;
    return tabModels.filter(
      (model) =>
        model.displayName.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle),
    );
  }, [tabModels, modelSearch]);

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
          className="bg-card overflow-hidden"
        >
          <div className="h-full flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold text-foreground">Provider Keys</span>
                {providerKeys.length > 0 && (
                  <Badge variant="secondary" className="tabular-nums">
                    {providerKeys.length}
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => dispatch(fetchProviderKeys({ force: true }))}
                aria-label="Refresh keys"
                title="Refresh"
              >
                <ArrowClockwise size={16} />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto py-1">
              {providerKeys.map((key) => {
                const isSelected = key.id === selectedKeyId && !showAddForm;
                const status = keyStatus(key);
                return (
                  <button
                    key={key.id}
                    type="button"
                    onClick={() => {
                      selectKey(key.id);
                      setShowAddForm(false);
                    }}
                    className={cn(
                      "w-full px-3 py-2.5 flex items-center gap-3 cursor-pointer text-left border-l-2 transition-colors",
                      isSelected
                        ? "bg-primary/10 border-primary"
                        : "border-transparent hover:bg-muted/60",
                    )}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                      {providerBrand(key.provider) ? (
                        <ProviderLogo provider={key.provider} size="md" />
                      ) : (
                        <Key size={16} className="text-muted-foreground" />
                      )}
                    </span>
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="text-sm font-medium truncate text-foreground">
                        {key.label}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {providerLabel(key.provider)} - {key.keyHint || "***"}
                      </span>
                    </div>
                    <StatusIcon status={status} size={14} />
                  </button>
                );
              })}
            </div>

            <div className="border-t border-border p-3">
              <Button
                variant={showAddForm ? "secondary" : "default"}
                size="sm"
                className="w-full"
                onClick={() => setShowAddForm(true)}
              >
                <Plus size={14} />
                Add provider key
              </Button>
            </div>
          </div>
        </Panel>

        <PaneSeparator />

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
                <div className="px-6 py-3 border-b border-border">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-border bg-muted">
                      {providerBrand(selectedKey.provider) ? (
                        <ProviderLogo provider={selectedKey.provider} size="lg" />
                      ) : (
                        <Key size={20} className="text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-lg font-semibold text-foreground">
                          {selectedKey.label}
                        </h2>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-xs font-medium",
                            STATUS_TEXT[keyStatus(selectedKey)],
                          )}
                        >
                          <StatusIcon status={keyStatus(selectedKey)} size={13} />
                          {STATUS_LABELS[keyStatus(selectedKey)]}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          {providerLabel(selectedKey.provider)}
                          <span className="font-mono">{selectedKey.keyHint || "***"}</span>
                        </span>
                        <MetaFact
                          icon={ClockCounterClockwise}
                          label="Used"
                          value={
                            formatRelativeTime(protoTimestampToDateStr(selectedKey.lastUsedAt)) ||
                            "never"
                          }
                        />
                        <MetaFact
                          icon={SealCheck}
                          label="Validated"
                          value={
                            formatRelativeTime(
                              protoTimestampToDateStr(selectedKey.lastValidatedAt),
                            ) || "never"
                          }
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative w-36 xl:w-48">
                        <MagnifyingGlass
                          size={14}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                          type="text"
                          placeholder="Search models..."
                          value={modelSearch}
                          onChange={(e) => setModelSearch(e.target.value)}
                          className="h-8 pl-8 text-xs"
                          data-testid="provider-models-search"
                        />
                      </div>
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
                            dispatch(fetchModelsForKey({ keyId: selectedKey.id, force: true }));
                          }
                        }}
                        aria-label="Refresh models"
                        title="Refresh models"
                      >
                        <ArrowClockwise size={16} />
                      </Button>

                      <span className="mx-1 h-6 w-px bg-border" />

                      <ToggleSwitch
                        enabled={selectedKey.isEnabled}
                        disabled={togglingKeyId === selectedKey.id}
                        onChange={(enabled) => handleToggle(selectedKey.id, enabled)}
                      />
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

                {!selectedKey.isValid && (
                  <div className="border-b border-border px-6 py-3">
                    <KeyErrorNotice
                      lastError={selectedKey.lastError}
                      provider={providerLabel(selectedKey.provider)}
                    />
                  </div>
                )}

                <div className="flex min-h-0 flex-1 flex-col">
                  {shownModels.length > 0 ? (
                    <div className="min-h-0 flex-1 overflow-y-auto p-4">
                      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                        {shownModels.map((model) => (
                          <ModelCard key={`${model.provider}:${model.id}`} model={model} />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6">
                      <Brain size={32} className="text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">No models to show</p>
                      <p className="mt-1 text-center text-xs text-muted-foreground">
                        {modelSearch.trim()
                          ? "Nothing matches that search"
                          : modelsTab !== "key"
                            ? "Add a valid provider key to see available models"
                            : selectedKey.isValid
                              ? "This key exposes no models yet"
                              : "A key the provider refused reaches no models"}
                      </p>
                    </div>
                  )}
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
