/* eslint-disable react-refresh/only-export-components -- pure picker logic is co-located for unit tests */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Brain, Check, X } from '@phosphor-icons/react';
import { MemoryScope } from '@uniffy/proto/agents/v1/memories_pb';
import { cn } from '@/shared/utils/cn';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { Modal } from '@/components/ui/modal';
import {
  selectAvailableModels,
  selectModelsForKey,
} from '@/features/agents/store/agentProvidersSlice';
import {
  fetchAvailableModels,
  fetchModelsForKey,
  type SerializedModelInfo,
} from '@/features/agents/store/agentProvidersThunks';
import { selectMemoryScope } from '@/features/agents/store/agentMemoriesSlice';
import {
  fetchMemories,
  memoryScopeKey,
  type MemoryScopeSubject,
} from '@/features/agents/store/agentMemoriesThunks';
import {
  MemoryList,
  type MemoryScopeDescriptor,
} from '@/features/agents/components/memory/MemoryList';
import type { SerializedAgent } from '@/features/agents/store/agentsThunks';
import {
  parseModelParamsSchema,
  stripInvalidParams,
  type ModelParamValues,
} from '@/features/agents/utils/modelParamsSchema';
import {
  selectChannelById,
  selectChannelMembers,
} from '@/features/chat/store/chatChannelsSlice';
import { useChatPermissions } from '@/features/chat/hooks/useChatPermissions';
import type {
  ChannelAgentConfigChanges,
  ChannelAgentConfigState,
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

/**
 * Params to send alongside a model switch, mirroring the backend: stored
 * params are stripped per the next effective model, but when that model has no
 * client-visible schema (name-only agent on the org default, stale list) they
 * are left untouched and the backend strips per the real effective model.
 * `undefined` = omit the field from the update.
 */
export const paramsChangesForModelSwitch = (
  models: SerializedModelInfo[],
  nextModelId: string | null,
  primaryModel: string,
  current: ModelParamValues,
): ModelParamValues | undefined => {
  if (Object.keys(current).length === 0) return undefined;
  const nextId = nextModelId ?? primaryModel;
  const nextSchemaJson = models.find((m) => m.id === nextId)?.parameterSchemaJson ?? '';
  if (!nextSchemaJson) return undefined;
  return paramsForModelSwitch(nextSchemaJson, current);
};

/**
 * Mirrors the backend's memory scope routing: a 1:1 agent DM is a personal
 * surface (the caller's own memories with this agent); everything else is
 * channel-shared.
 */
export const memoryScopeForChannel = (
  channel: { isAgentDm?: boolean; channelType?: string } | undefined,
  channelId: string,
): MemoryScopeSubject =>
  channel?.isAgentDm && channel.channelType === 'DIRECT'
    ? { scope: MemoryScope.USER }
    : { scope: MemoryScope.CHANNEL, subjectId: channelId };

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
  config,
  updating,
  update,
}: {
  channelId: string;
  agent: SerializedAgent;
  config: ChannelAgentConfigState | null;
  updating: boolean;
  update: (changes: ChannelAgentConfigChanges) => Promise<void>;
}) {
  const dispatch = useAppDispatch();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PickerPosition | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);

  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? '');
  const channel = useAppSelector((s) => selectChannelById(s, channelId));
  const channelMembers = useAppSelector((s) => selectChannelMembers(s, channelId));
  const { canManageChat } = useChatPermissions();
  const isAgentDm = channel?.isAgentDm ?? false;
  const channelType = channel?.channelType;
  const memorySubject = useMemo(
    () => memoryScopeForChannel({ isAgentDm, channelType }, channelId),
    [isAgentDm, channelType, channelId],
  );
  const isPersonalMemory = memorySubject.scope === MemoryScope.USER;
  const memoryState = useAppSelector(selectMemoryScope(memoryScopeKey(memorySubject)));

  const memberRole = channelMembers.find(
    (m) => m.subjectType === 'USER' && m.userId === currentUserId,
  )?.role;
  const isModerator = canManageChat || memberRole === 'OWNER' || memberRole === 'ADMIN';

  const memoryDescriptor = useMemo<MemoryScopeDescriptor>(
    () =>
      isPersonalMemory
        ? {
            scope: MemoryScope.USER,
            canCreate: true,
            canPin: true,
            canEdit: () => true,
            canDelete: () => true,
          }
        : {
            scope: MemoryScope.CHANNEL,
            subjectId: channelId,
            canCreate: false,
            canPin: isModerator,
            canEdit: (m) => m.createdByUserId === currentUserId || isModerator,
            canDelete: (m) => m.createdByUserId === currentUserId || isModerator,
          },
    [isPersonalMemory, channelId, currentUserId, isModerator],
  );
  const channelLabel =
    channel && (channel.channelType === 'PUBLIC' || channel.channelType === 'PRIVATE')
      ? channel.name
      : undefined;

  useEffect(() => {
    if (!open) return;
    dispatch(fetchMemories({ agentId: agent.id, ...memorySubject }));
  }, [dispatch, open, agent.id, memorySubject]);

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
  const label = pickerButtonLabel(config, agent.primaryModel, models);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
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
    const nextParams = paramsChangesForModelSwitch(
      models,
      modelId,
      agent.primaryModel,
      config.modelParams,
    );
    if (nextParams !== undefined) changes.modelParams = nextParams;
    void update(changes);
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
            <div className="mt-3 border-t border-border pt-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setMemoryOpen(true);
                }}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted transition-colors"
                data-testid="chat-compose-agent-memory-button"
              >
                <Brain size={14} weight="duotone" className="text-muted-foreground shrink-0" />
                <span>
                  Memory{memoryState.loaded ? ` (${memoryState.totalCount})` : ''}
                </span>
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {/* Portaled: the composer's glass card is a `backdrop-filter` containing
          block, so an in-place fixed modal would anchor to it and clip. */}
      {memoryOpen && createPortal(
        <Modal onClose={() => setMemoryOpen(false)} maxWidth="max-w-2xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2 min-w-0">
              <Brain size={18} weight="duotone" className="text-muted-foreground shrink-0" />
              <span className="font-medium text-foreground truncate">
                {isPersonalMemory ? `My memory - ${agent.name}` : `Channel memory - ${agent.name}`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMemoryOpen(false)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="p-4 overflow-y-auto max-h-[70dvh]">
            <MemoryList
              agentId={agent.id}
              agentName={agent.name}
              descriptor={memoryDescriptor}
              subjectLabel={isPersonalMemory ? undefined : channelLabel}
            />
          </div>
        </Modal>,
        document.body,
      )}
    </>
  );
}
