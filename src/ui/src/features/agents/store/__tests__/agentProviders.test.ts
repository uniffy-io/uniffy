import { describe, expect, it } from "vitest";
import {
  agentProvidersReducer,
  selectModelsForKey,
  selectModelsLoadingForKey,
} from "@/features/agents/store/agentProvidersSlice";
import {
  fetchAvailableModels,
  fetchModelsForKey,
  fetchProviderKeys,
  type SerializedModelInfo,
  type SerializedProviderKey,
} from "@/features/agents/store/agentProvidersThunks";

const ORG = "org-1";

const key = (id: string, provider: string): SerializedProviderKey => ({
  id,
  provider,
  label: `${provider} key`,
  keyHint: "...abcd",
  isValid: true,
  isEnabled: true,
  lastValidatedAt: undefined,
  lastUsedAt: undefined,
  lastError: "",
  createdAt: undefined,
  updatedAt: undefined,
  createdBy: "user-1",
});

const model = (id: string, provider: string): SerializedModelInfo => ({
  id,
  displayName: id,
  provider,
  contextWindow: 200000,
  supportsTools: true,
  supportsVision: true,
  supportsThinking: false,
  supportsImageGeneration: false,
  supportsPromptCache: true,
  deprecated: false,
  catalogKnown: true,
  inputPer1m: "3",
  outputPer1m: "15",
  cacheReadPer1m: "0.3",
  cacheWritePer1m: "3.75",
  parameterSchemaJson: "",
  imageParameterSchemaJson: "",
  imagePriceEstimatesJson: "",
});

const withKeys = (keys: SerializedProviderKey[]) =>
  agentProvidersReducer(
    undefined,
    fetchProviderKeys.fulfilled({ organizationId: ORG, keys }, "req", undefined),
  );

const asRoot = (state: ReturnType<typeof agentProvidersReducer>) =>
  ({ agentProviders: state }) as never;

describe("agentProviders slice", () => {
  it("serves every key of a provider from the org-wide model fetch", () => {
    const withBothKeys = withKeys([key("key-a", "anthropic"), key("key-b", "anthropic")]);
    const state = agentProvidersReducer(
      withBothKeys,
      fetchAvailableModels.fulfilled(
        { organizationId: ORG, models: [model("claude-opus-5", "anthropic")] },
        "req",
        undefined,
      ),
    );

    expect(selectModelsForKey("key-a")(asRoot(state))).toHaveLength(1);
    expect(selectModelsForKey("key-b")(asRoot(state))).toHaveLength(1);
    expect(selectModelsLoadingForKey("key-b")(asRoot(state))).toBe(false);
  });

  it("splits the org-wide list per provider", () => {
    const state = agentProvidersReducer(
      withKeys([key("key-a", "anthropic"), key("key-b", "openai")]),
      fetchAvailableModels.fulfilled(
        {
          organizationId: ORG,
          models: [model("claude-opus-5", "anthropic"), model("gpt-5", "openai")],
        },
        "req",
        undefined,
      ),
    );

    expect(selectModelsForKey("key-a")(asRoot(state)).map((m) => m.id)).toEqual(["claude-opus-5"]);
    expect(selectModelsForKey("key-b")(asRoot(state)).map((m) => m.id)).toEqual(["gpt-5"]);
  });

  it("reports loading while a key fetch is on the wire and clears it after", () => {
    const pending = agentProvidersReducer(
      withKeys([key("key-a", "google")]),
      fetchModelsForKey.pending("req", { keyId: "key-a" }),
    );
    expect(selectModelsLoadingForKey("key-a")(asRoot(pending))).toBe(true);

    const done = agentProvidersReducer(
      pending,
      fetchModelsForKey.fulfilled(
        { organizationId: ORG, keyId: "key-a", models: [model("gemini-3", "google")] },
        "req",
        { keyId: "key-a" },
      ),
    );
    expect(selectModelsLoadingForKey("key-a")(asRoot(done))).toBe(false);
    expect(selectModelsForKey("key-a")(asRoot(done)).map((m) => m.id)).toEqual(["gemini-3"]);
  });

  it("marks a provider with no models resolved so the picker stops waiting", () => {
    const state = agentProvidersReducer(
      withKeys([key("key-a", "google")]),
      fetchModelsForKey.fulfilled({ organizationId: ORG, keyId: "key-a", models: [] }, "req", {
        keyId: "key-a",
      }),
    );

    expect(selectModelsForKey("key-a")(asRoot(state))).toEqual([]);
    expect(selectModelsLoadingForKey("key-a")(asRoot(state))).toBe(false);
  });

  it("drops cached keys and models when the payload belongs to another org", () => {
    const first = agentProvidersReducer(
      withKeys([key("key-a", "anthropic")]),
      fetchAvailableModels.fulfilled(
        { organizationId: ORG, models: [model("claude-opus-5", "anthropic")] },
        "req",
        undefined,
      ),
    );

    const switched = agentProvidersReducer(
      first,
      fetchProviderKeys.fulfilled(
        { organizationId: "org-2", keys: [key("key-z", "openai")] },
        "req",
        undefined,
      ),
    );

    expect(switched.providerKeys["key-a"]).toBeUndefined();
    expect(selectModelsForKey("key-a")(asRoot(switched))).toEqual([]);
    expect(switched.availableModels).toEqual([]);
    expect(switched.modelsStatus).toBe("idle");
  });

  it("reopens the org-wide fetch after a key mutation changes the enabled set", () => {
    const loaded = agentProvidersReducer(
      withKeys([key("key-a", "anthropic")]),
      fetchAvailableModels.fulfilled(
        { organizationId: ORG, models: [model("claude-opus-5", "anthropic")] },
        "req",
        undefined,
      ),
    );
    expect(loaded.modelsStatus).toBe("loaded");

    const toggled = agentProvidersReducer(loaded, {
      type: "agentProviders/toggleProviderKey/fulfilled",
      payload: { ...key("key-a", "anthropic"), isEnabled: false },
    });
    expect(toggled.modelsStatus).toBe("idle");
  });
});
