import { useEffect, useMemo, useRef, useState } from "react";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { createPortal } from "react-dom";
import { Brain, Check } from "@phosphor-icons/react";
import { MemoryScope } from "@uniffy/proto/agents/v1/memories_pb";
import { popoverShellClass } from "@/components/ui/popover";
import { cn } from "@/shared/utils/cn";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Modal, ModalBody, ModalHeader } from "@/components/ui/modal";
import {
  selectAvailableModels,
  selectModelsForKey,
  selectModelsLoadingForKey,
} from "@/features/agents/store/agentProvidersSlice";
import {
  fetchAvailableModels,
  fetchModelsForKey,
} from "@/features/agents/store/agentProvidersThunks";
import { selectMemoryScope } from "@/features/agents/store/agentMemoriesSlice";
import { fetchMemories, memoryScopeKey } from "@/features/agents/store/agentMemoriesThunks";
import {
  MemoryList,
  type MemoryScopeDescriptor,
} from "@/features/agents/components/memory/MemoryList";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import {
  buildModelOptions,
  filterChatModels,
  memoryScopeForChannel,
  modelDisplayName,
  paramsChangesForModelSwitch,
  pickerButtonLabel,
} from "@/features/chat/components/compose/agentModelSelection";
import { selectChannelById, selectChannelMembers } from "@/features/chat/store/chatChannelsSlice";
import { useChatPermissions } from "@/features/chat/hooks/useChatPermissions";
import type {
  ChannelAgentConfigChanges,
  ChannelAgentConfigState,
} from "@/features/chat/hooks/useChannelAgentConfig";

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

  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? "");
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
    (m) => m.subjectType === "USER" && m.userId === currentUserId,
  )?.role;
  const isModerator = canManageChat || memberRole === "OWNER" || memberRole === "ADMIN";

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
    channel && (channel.channelType === "PUBLIC" || channel.channelType === "PRIVATE")
      ? channel.name
      : undefined;

  useEffect(() => {
    if (!open) return;
    dispatch(fetchMemories(memorySubject));
  }, [dispatch, open, memorySubject]);

  const keyId = agent.primaryProviderKeyId;
  const keyModels = useAppSelector(selectModelsForKey(keyId));
  const orgModels = useAppSelector(selectAvailableModels);
  const modelsLoading = useAppSelector(selectModelsLoadingForKey(keyId));
  const models = keyId ? keyModels : orgModels;

  // Chat init prefetches both lists, so this usually resolves to a no-op; it
  // still covers an agent pointing at a disabled or invalid key.
  useEffect(() => {
    if (keyId) {
      dispatch(fetchModelsForKey({ keyId }));
    } else {
      dispatch(fetchAvailableModels());
    }
  }, [dispatch, keyId]);

  const chatModels = useMemo(() => filterChatModels(models), [models]);
  const overrideId = config?.modelOverride ?? null;
  const options = useMemo(
    () => buildModelOptions(chatModels, overrideId),
    [chatModels, overrideId],
  );
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
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  useOverlayEscape(() => setOpen(false), open);

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
      "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
      selected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
      disabled && "opacity-50 cursor-not-allowed",
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
          "flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs",
          "text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
        )}
        data-testid="chat-compose-model-button"
        data-state={open ? "open" : "closed"}
      >
        <Brain size={16} />
        <span className="hidden sm:inline max-w-[160px] truncate">{label}</span>
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={containerRef}
            className="fixed z-[200]"
            style={{ bottom: position.bottom, left: position.left }}
            data-testid="chat-compose-model-popover"
          >
            <div
              className={cn(popoverShellClass, "w-80 overflow-y-auto rounded-xl p-3")}
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
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    {modelsLoading ? "Loading models..." : "No models available"}
                  </p>
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
                    Memory
                    {memoryState.loaded ? ` (${memoryState.totalCount})` : ""}
                  </span>
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {memoryOpen && (
        <Modal
          onClose={() => setMemoryOpen(false)}
          maxWidth="max-w-2xl"
          className="flex flex-col max-h-[85dvh]"
        >
          <ModalHeader
            title={isPersonalMemory ? "My memory" : "Channel memory"}
            onClose={() => setMemoryOpen(false)}
          />
          <ModalBody scrollable={false} className="flex-1 min-h-0 overflow-y-auto">
            <MemoryList
              agentName={agent.name}
              descriptor={memoryDescriptor}
              subjectLabel={isPersonalMemory ? undefined : channelLabel}
            />
          </ModalBody>
        </Modal>
      )}
    </>
  );
}
