/* eslint-disable react-refresh/only-export-components -- pure popover logic is co-located for unit tests */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowCounterClockwise, Faders } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  selectAvailableModels,
  selectModelsForKey,
} from "@/features/agents/store/agentProvidersSlice";
import { fetchModelsForKey } from "@/features/agents/store/agentProvidersThunks";
import type { SerializedModelInfo } from "@/features/agents/store/agentProvidersThunks";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import { ModelParamsSection } from "@/features/agents/components/ModelParamsSection";
import { ImageCostHint } from "@/features/agents/components/ImageCostHint";
import { parseImagePriceEstimates } from "@/features/agents/utils/imageParams";
import { IMAGE_GENERATION_TOOL } from "@/features/agents/config/toolCatalog";
import {
  parseModelParamValues,
  type ModelParamValues,
} from "@/features/agents/utils/modelParamsSchema";
import {
  modelDisplayName,
  resolveEffectiveModelId,
} from "@/features/chat/components/compose/AgentModelPicker";
import type {
  ChannelAgentConfigChanges,
  ChannelAgentConfigState,
} from "@/features/chat/hooks/useChannelAgentConfig";

export const hasParamsOverride = (config: ChannelAgentConfigState | null): boolean =>
  Object.keys(config?.modelParams ?? {}).length > 0 ||
  Object.keys(config?.imageParams ?? {}).length > 0;

/** The agent's image model generates nothing here unless the tool is enabled. */
export const imageSchemaFor = (
  models: SerializedModelInfo[],
  agent: Pick<SerializedAgent, "enabledTools" | "imageModel">,
): { schemaJson: string; estimatesJson: string } => {
  if (!agent.imageModel || !agent.enabledTools.includes(IMAGE_GENERATION_TOOL)) {
    return { schemaJson: "", estimatesJson: "" };
  }
  const model = models.find((m) => m.id === agent.imageModel);
  return {
    schemaJson: model?.imageParameterSchemaJson ?? "",
    estimatesJson: model?.imagePriceEstimatesJson ?? "",
  };
};

/** Schema of the model the conversation actually runs on (override else agent primary). */
export const effectiveParamsSchemaJson = (
  models: SerializedModelInfo[],
  config: Pick<ChannelAgentConfigState, "modelOverride"> | null,
  primaryModel: string,
): string => {
  const effectiveId = resolveEffectiveModelId(config, primaryModel);
  return models.find((m) => m.id === effectiveId)?.parameterSchemaJson ?? "";
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
  const dispatch = useAppDispatch();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  // The sibling model picker owns the chat model-list fetch; this popover reads it.
  const keyId = agent.primaryProviderKeyId;
  const keyModels = useAppSelector(selectModelsForKey(keyId));
  const orgModels = useAppSelector(selectAvailableModels);
  const models = keyId ? keyModels : orgModels;

  // The image model usually sits under a DIFFERENT provider key than the chat
  // model, so it is absent from `models` and needs its own lookup. No sibling
  // control fetches that key's list, so this one does.
  const imageKeyId = agent.imageProviderKeyId;
  const imageKeyModels = useAppSelector(selectModelsForKey(imageKeyId));
  const imageModels = imageKeyId ? imageKeyModels : orgModels;

  useEffect(() => {
    if (imageKeyId) dispatch(fetchModelsForKey({ keyId: imageKeyId }));
  }, [dispatch, imageKeyId]);

  const schemaJson = useMemo(
    () => effectiveParamsSchemaJson(models, config, agent.primaryModel),
    [models, config, agent.primaryModel],
  );
  const effectiveId = resolveEffectiveModelId(config, agent.primaryModel);
  const overrideActive = hasParamsOverride(config);

  // The image model is the agent's own; a per-conversation model override
  // changes the chat model only, so this does not depend on `config`.
  const image = useMemo(() => imageSchemaFor(imageModels, agent), [imageModels, agent]);
  const imageEstimates = useMemo(
    () => parseImagePriceEstimates(image.estimatesJson),
    [image.estimatesJson],
  );

  // An unset knob here falls through to the agent's own configuration, so that
  // is what the controls must show - not the provider default the builder may
  // already have moved away from.
  const agentParams = useMemo(() => parseModelParamValues(agent.modelParams), [agent.modelParams]);
  const agentImageParams = useMemo(
    () => parseModelParamValues(agent.imageParams),
    [agent.imageParams],
  );
  const effectiveImageParams = useMemo(
    () => ({ ...agentImageParams, ...(config?.imageParams ?? {}) }),
    [agentImageParams, config?.imageParams],
  );

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      // Enum params render their dropdown in a body portal; a click there
      // must not count as outside the popover.
      if (target.closest?.("[data-select-portal]")) return;
      setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
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

  const handleImageParamsChange = (next: ModelParamValues) => {
    if (disabled) return;
    void update({ imageParams: next });
  };

  const handleReset = () => {
    if (disabled || !overrideActive) return;
    void update({ modelParams: {}, imageParams: {} });
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
          "relative flex items-center px-2 py-1.5 rounded-md",
          "text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
        )}
        data-testid="chat-compose-params-button"
        data-state={open ? "open" : "closed"}
        data-override-active={overrideActive ? "true" : "false"}
      >
        <Faders size={16} />
        {overrideActive && (
          <span
            className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary"
            data-testid="chat-compose-params-active-dot"
          />
        )}
      </button>
      {open &&
        position &&
        createPortal(
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
                Overrides for{" "}
                <span className="text-foreground">
                  {effectiveId
                    ? modelDisplayName(models, effectiveId)
                    : "the organization default model"}
                </span>{" "}
                in this conversation. The agent itself is not changed.
              </p>
              {schemaJson ? (
                <ModelParamsSection
                  schemaJson={schemaJson}
                  values={config?.modelParams ?? {}}
                  inheritedValues={agentParams}
                  onChange={handleParamsChange}
                  disabled={disabled}
                />
              ) : effectiveId ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No tunable parameters for this model.
                </p>
              ) : (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  This agent follows the organization default model. Pick a model for this
                  conversation to tune its parameters.
                </p>
              )}
              {image.schemaJson && (
                <ModelParamsSection
                  title="Image Generation"
                  audience="user"
                  schemaJson={image.schemaJson}
                  values={config?.imageParams ?? {}}
                  inheritedValues={agentImageParams}
                  onChange={handleImageParamsChange}
                  disabled={disabled}
                  renderRowSuffix={(key) =>
                    key === "resolution" || key === "quality" ? (
                      <ImageCostHint estimates={imageEstimates} values={effectiveImageParams} />
                    ) : null
                  }
                />
              )}
              <div className="mt-3 border-t border-border pt-2">
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={disabled || !overrideActive}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    overrideActive && !disabled
                      ? "text-foreground hover:bg-muted"
                      : "text-muted-foreground opacity-50 cursor-not-allowed",
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
