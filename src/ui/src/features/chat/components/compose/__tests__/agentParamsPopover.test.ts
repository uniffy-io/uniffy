import { describe, it, expect, vi } from "vitest";

vi.mock("@/features/agents/api/providersApi", () => ({ providersApi: {} }));
vi.mock("@/features/chat/api/chatApi", () => ({ chatApi: {} }));
vi.mock("@/config", () => ({ friendlyErrorMessage: (message: string) => message }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import {
  effectiveParamsSchemaJson,
  hasParamsOverride,
} from "@/features/chat/components/compose/AgentParamsPopover";
import { parseModelParamsSchema } from "@/features/agents/utils/modelParamsSchema";
import type { SerializedModelInfo } from "@/features/agents/store/agentProvidersThunks";

function model(overrides: Partial<SerializedModelInfo> = {}): SerializedModelInfo {
  return {
    id: "anthropic/claude",
    displayName: "Claude",
    provider: "anthropic",
    contextWindow: 200_000,
    supportsTools: true,
    supportsVision: true,
    supportsThinking: true,
    supportsImageGeneration: false,
    catalogKnown: true,
    parameterSchemaJson: "",
    imageParameterSchemaJson: "",
    imagePriceEstimatesJson: "",
    ...overrides,
  };
}

const primarySchema = JSON.stringify({
  temperature: { type: "number", minimum: 0, maximum: 2 },
});
const overrideSchema = JSON.stringify({
  reasoning_effort: { type: "enum", enum: ["off", "low", "high"] },
  provider_options: { top_k: { type: "integer", minimum: 1, maximum: 500 } },
});
const models = [
  model({ id: "primary-id", parameterSchemaJson: primarySchema }),
  model({ id: "override-id", parameterSchemaJson: overrideSchema }),
];

describe("hasParamsOverride", () => {
  it("is false without a config or with empty params", () => {
    expect(hasParamsOverride(null)).toBe(false);
    expect(hasParamsOverride({ modelOverride: null, modelParams: {}, imageParams: {} })).toBe(
      false,
    );
  });

  it("is true once any knob is set", () => {
    expect(
      hasParamsOverride({
        modelOverride: null,
        modelParams: { temperature: 0.2 },
        imageParams: {},
      }),
    ).toBe(true);
  });
});

describe("effectiveParamsSchemaJson", () => {
  it("uses the primary model schema without an override", () => {
    expect(effectiveParamsSchemaJson(models, null, "primary-id")).toBe(primarySchema);
    expect(effectiveParamsSchemaJson(models, { modelOverride: null }, "primary-id")).toBe(
      primarySchema,
    );
  });

  it("follows the model override so the form renders the override schema fields", () => {
    const schemaJson = effectiveParamsSchemaJson(
      models,
      { modelOverride: "override-id" },
      "primary-id",
    );
    expect(schemaJson).toBe(overrideSchema);
    const schema = parseModelParamsSchema(schemaJson);
    expect(Object.keys(schema?.params ?? {})).toEqual(["reasoning_effort"]);
    expect(Object.keys(schema?.providerOptions ?? {})).toEqual(["top_k"]);
  });

  it("is empty for a model missing from the list", () => {
    expect(effectiveParamsSchemaJson(models, { modelOverride: "gone" }, "primary-id")).toBe("");
    expect(effectiveParamsSchemaJson([], null, "primary-id")).toBe("");
  });
});
