/* eslint-disable react-refresh/only-export-components -- pure popover logic is co-located for unit tests */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowCounterClockwise, Faders } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { useAppSelector } from '@/app/hooks';
import {
  selectAvailableModels,
  selectModelsForKey,
} from '@/features/agents/store/agentProvidersSlice';
import type { SerializedModelInfo } from '@/features/agents/store/agentProvidersThunks';
import type { SerializedAgent } from '@/features/agents/store/agentsThunks';
import { ModelParamsSection } from '@/features/agents/components/ModelParamsSection';
import type { ModelParamValues } from '@/features/agents/utils/modelParamsSchema';
import {
  modelDisplayName,
  resolveEffectiveModelId,
} from '@/features/chat/components/compose/AgentModelPicker';
import type {
  ChannelAgentConfigChanges,
  ChannelAgentConfigState,
} from '@/features/chat/hooks/useChannelAgentConfig';

export const hasParamsOverride = (config: ChannelAgentConfigState | null): boolean =>
  Object.keys(config?.modelParams ?? {}).length > 0;

/** Schema of the model the conversation actually runs on (override else agent primary). */
export const effectiveParamsSchemaJson = (
  models: SerializedModelInfo[],
  config: Pick<ChannelAgentConfigState, 'modelOverride'> | null,
  primaryModel: string,
): string => {
  const effectiveId = resolveEffectiveModelId(config, primaryModel);
  return models.find((m) => m.id === effectiveId)?.parameterSchemaJson ?? '';
};

const POPOVER_WIDTH = 320;
const POPOVER_MAX_HEIGHT = 480;

interface PopoverPosition {
  bottom: number;
  left: number;
  maxHeight: number;
}

export function AgentParamsPopover({
  agent,
  config,
  updating,
  update,
}: {
  agent: SerializedAgent;
  config: ChannelAgentConfigState | null;
  updating: boolean;
  update: (changes: ChannelAgentConfigChanges) => Promise<void>;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  // The sibling model picker owns the model-list fetch; this popover only reads.
  const keyId = agent.primaryProviderKeyId;
  const keyModels = useAppSelector(selectModelsForKey(keyId));
  const orgModels = useAppSelector(selectAvailableModels);
  const models = keyId ? keyModels : orgModels;

  const schemaJson = useMemo(
    () => effectiveParamsSchemaJson(models, config, agent.primaryModel),
    [models, config, agent.primaryModel],
  );
  const effectiveId = resolveEffectiveModelId(config, agent.primaryModel);
  const overrideActive = hasParamsOverride(config);

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

  const handleParamsChange = (next: ModelParamValues) => {
    if (disabled) return;
    void update({ modelParams: next });
  };

  const handleReset = () => {
    if (disabled || !overrideActive) return;
    void update({ modelParams: {} });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        aria-label="Model parameters for this conversation"
        title="Model parameters for this conversation"
        className={cn(
          'relative flex items-center px-2 py-1.5 rounded-md',
          'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
        )}
        data-testid="chat-compose-params-button"
        data-state={open ? 'open' : 'closed'}
        data-override-active={overrideActive ? 'true' : 'false'}
      >
        <Faders size={16} />
        {overrideActive && (
          <span
            className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary"
            data-testid="chat-compose-params-active-dot"
          />
        )}
      </button>
      {open && position && createPortal(
        <div
          ref={containerRef}
          className="fixed z-[200]"
          style={{ bottom: position.bottom, left: position.left }}
          data-testid="chat-compose-params-popover"
        >
          <div
            className="w-80 overflow-y-auto rounded-xl border border-border bg-card shadow-xl p-3"
            style={{ maxHeight: position.maxHeight }}
          >
            <p className="px-2 pb-2 text-xs leading-snug text-muted-foreground">
              Overrides for{' '}
              <span className="text-foreground">
                {effectiveId
                  ? modelDisplayName(models, effectiveId)
                  : 'the organization default model'}
              </span>{' '}
              in this conversation. The agent itself is not changed.
            </p>
            {schemaJson ? (
              <ModelParamsSection
                schemaJson={schemaJson}
                values={config?.modelParams ?? {}}
                onChange={handleParamsChange}
                disabled={disabled}
              />
            ) : effectiveId ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No tunable parameters for this model.
              </p>
            ) : (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                This agent follows the organization default model. Pick a model
                for this conversation to tune its parameters.
              </p>
            )}
            <div className="mt-3 border-t border-border pt-2">
              <button
                type="button"
                onClick={handleReset}
                disabled={disabled || !overrideActive}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  overrideActive && !disabled
                    ? 'text-foreground hover:bg-muted'
                    : 'text-muted-foreground opacity-50 cursor-not-allowed',
                )}
                data-testid="chat-compose-params-reset"
              >
                <ArrowCounterClockwise size={14} weight="bold" className="shrink-0" />
                <span>Reset to agent defaults</span>
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
