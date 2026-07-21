/* eslint-disable react-refresh/only-export-components -- pure picker logic is co-located for unit tests */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Brain, Check } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  selectAvailableModels,
  selectModelsForKey,
} from '@/features/agents/store/agentProvidersSlice';
import {
  fetchAvailableModels,
  fetchModelsForKey,
  type SerializedModelInfo,
} from '@/features/agents/store/agentProvidersThunks';
import type { SerializedAgent } from '@/features/agents/store/agentsThunks';
import { ModelParamsSection } from '@/features/agents/components/ModelParamsSection';
import {
  parseModelParamsSchema,
  stripInvalidParams,
  type ModelParamValues,
} from '@/features/agents/utils/modelParamsSchema';
import {
  useChannelAgentConfig,
  type ChannelAgentConfigChanges,
  type ChannelAgentConfigState,
} from '@/features/chat/hooks/useChannelAgentConfig';

// Curated catalog chat models only - keeps live-API noise (whisper, realtime,
// embeddings, image-only) out of the picker.
export const filterChatModels = (models: SerializedModelInfo[]): SerializedModelInfo[] =>
  models.filter((m) => m.catalogKnown && !m.supportsImageGeneration);

export const modelDisplayName = (models: SerializedModelInfo[], modelId: string): string =>
  models.find((m) => m.id === modelId)?.displayName || modelId;

export const resolveEffectiveModelId = (
  config: Pick<ChannelAgentConfigState, 'modelOverride'> | null,
  primaryModel: string,
): string => config?.modelOverride || primaryModel;

export const pickerButtonLabel = (
  config: Pick<ChannelAgentConfigState, 'modelOverride'> | null,
  primaryModel: string,
  models: SerializedModelInfo[],
): string =>
  config?.modelOverride
    ? modelDisplayName(models, config.modelOverride)
    : `Default (${modelDisplayName(models, primaryModel)})`;

/** Keeps a stale override visible even if the key/catalog no longer lists it. */
export const buildModelOptions = (
  chatModels: SerializedModelInfo[],
  modelOverride: string | null,
): Array<{ id: string; label: string }> => {
  const options = chatModels.map((m) => ({ id: m.id, label: m.displayName || m.id }));
  if (modelOverride && !chatModels.some((m) => m.id === modelOverride)) {
    options.unshift({ id: modelOverride, label: modelOverride });
  }
  return options;
};

export const paramsForModelSwitch = (
  nextSchemaJson: string,
  current: ModelParamValues,
): ModelParamValues => stripInvalidParams(parseModelParamsSchema(nextSchemaJson), current);

const POPOVER_WIDTH = 320;
const POPOVER_MAX_HEIGHT = 480;

interface PickerPosition {
  bottom: number;
  left: number;
  maxHeight: number;
}

export function AgentModelPicker({
  channelId,
  agent,
}: {
  channelId: string;
  agent: SerializedAgent;
}) {
  const dispatch = useAppDispatch();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PickerPosition | null>(null);

  const { config, updating, update } = useChannelAgentConfig(channelId, agent.id);

  const keyId = agent.primaryProviderKeyId;
  const keyModels = useAppSelector(selectModelsForKey(keyId));
  const orgModels = useAppSelector(selectAvailableModels);
  const models = keyId ? keyModels : orgModels;

  useEffect(() => {
    if (keyId) {
      dispatch(fetchModelsForKey({ keyId }));
    } else {
      dispatch(fetchAvailableModels());
    }
  }, [dispatch, keyId]);

  const chatModels = useMemo(() => filterChatModels(models), [models]);
  const overrideId = config?.modelOverride ?? null;
  const options = useMemo(() => buildModelOptions(chatModels, overrideId), [chatModels, overrideId]);
  const effectiveId = resolveEffectiveModelId(config, agent.primaryModel);
  const effectiveSchemaJson = useMemo(
    () => models.find((m) => m.id === effectiveId)?.parameterSchemaJson ?? '',
    [models, effectiveId],
  );
  const label = pickerButtonLabel(config, agent.primaryModel, models);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      // Enum params render their dropdown in a body portal; a click there
      // must not count as outside the popover.
      if (target.closest?.('[data-select-portal]')) return;
      setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const anchor = buttonRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    let left = rect.left;
    if (left + POPOVER_WIDTH > window.innerWidth - 8) {
      left = window.innerWidth - POPOVER_WIDTH - 8;
    }
    if (left < 8) left = 8;
    setPosition({
      bottom: window.innerHeight - rect.top + 8,
      left,
      maxHeight: Math.min(POPOVER_MAX_HEIGHT, rect.top - 16),
    });
    setOpen(true);
  };

  const disabled = updating || !config;

  const handleSelect = (modelId: string | null) => {
    if (!config || updating) return;
    if (modelId === overrideId) return;
    const changes: ChannelAgentConfigChanges = { modelOverride: modelId };
    if (Object.keys(config.modelParams).length > 0) {
      const nextId = modelId ?? agent.primaryModel;
      const nextSchemaJson = models.find((m) => m.id === nextId)?.parameterSchemaJson ?? '';
      changes.modelParams = paramsForModelSwitch(nextSchemaJson, config.modelParams);
    }
    void update(changes);
  };

  const handleParamsChange = (next: ModelParamValues) => {
    void update({ modelParams: next });
  };

  const rowClass = (selected: boolean) =>
    cn(
      'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
      selected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted',
      disabled && 'opacity-50 cursor-not-allowed',
    );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        aria-label="Model for this conversation"
        title="Model for this conversation"
        className={cn(
          'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs',
          'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
        )}
        data-testid="chat-compose-model-button"
        data-state={open ? 'open' : 'closed'}
      >
        <Brain size={16} />
        <span className="hidden sm:inline max-w-[160px] truncate">{label}</span>
      </button>
      {open && position && createPortal(
        <div
          ref={containerRef}
          className="fixed z-[200]"
          style={{ bottom: position.bottom, left: position.left }}
          data-testid="chat-compose-model-popover"
        >
          <div
            className="w-80 overflow-y-auto rounded-xl border border-border bg-card shadow-xl p-3"
            style={{ maxHeight: position.maxHeight }}
          >
            <div className="flex items-center gap-1.5 px-2 pb-2 text-xs font-semibold text-foreground uppercase tracking-wider">
              <Brain size={14} weight="duotone" className="text-muted-foreground" />
              Model
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => handleSelect(null)}
                disabled={disabled}
                className={rowClass(overrideId === null)}
                data-testid="chat-compose-model-default"
              >
                <span className="min-w-0 truncate">
                  Agent default
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {modelDisplayName(models, agent.primaryModel)}
                  </span>
                </span>
                {overrideId === null && (
                  <Check size={14} weight="bold" className="text-primary shrink-0" />
                )}
              </button>
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleSelect(option.id)}
                  disabled={disabled}
                  className={rowClass(option.id === overrideId)}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {option.id === overrideId && (
                    <Check size={14} weight="bold" className="text-primary shrink-0" />
                  )}
                </button>
              ))}
              {options.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No models available</p>
              )}
            </div>
            <div className="mt-3">
              <ModelParamsSection
                schemaJson={effectiveSchemaJson}
                values={config?.modelParams ?? {}}
                onChange={handleParamsChange}
                disabled={disabled}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
