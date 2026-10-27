import { configureStore } from "@reduxjs/toolkit";
import { create } from "@bufbuild/protobuf";
import { beforeEach, expect, it, vi } from "vitest";
import { ModelInfoSchema, ProviderKeyInfoSchema } from "@uniffy/proto/agents/v1/providers_pb";
import { RuntimeSettingsSchema } from "@uniffy/proto/agents/v1/runtime_pb";
import type { AppDispatch, RootState } from "@/app/store";
import { agentRuntimeSettingsReducer } from "@/features/admin/store/agentRuntimeSettingsSlice";
import { agentProvidersReducer } from "@/features/agents/store/agentProvidersSlice";
import {
  fetchProviderKeys,
  providerKeyToPlain,
} from "@/features/agents/store/agentProvidersThunks";
import { connectProvider } from "@/features/onboarding/store/onboardingSetupThunks";
import { selectConfiguredProvider } from "@/features/onboarding/store/onboardingSlice";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  list: vi.fn(),
  models: vi.fn(),
  runtime: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/config/api", () => ({ unaryTransport: {}, transport: {} }));
vi.mock("@/features/agents/api/providersApi", () => ({
  providersApi: {
    addProviderKey: mocks.add,
    listProviderKeys: mocks.list,
    listModelsForKey: mocks.models,
  },
}));
vi.mock("@/features/admin/api/agentRuntimeSettingsApi", () => ({
  agentRuntimeSettingsApi: {
    getRuntimeSettings: mocks.runtime,
    updateRuntimeSettings: mocks.save,
  },
}));
vi.mock("@/features/admin/api/invitationsApi", () => ({ invitationsApi: {} }));

const key = create(ProviderKeyInfoSchema, {
  id: "key",
  provider: "anthropic",
  isValid: true,
  isEnabled: true,
});
const model = create(ModelInfoSchema, {
  id: "chat-model",
  displayName: "Chat model",
  provider: "anthropic",
  supportsTools: true,
  providerDefault: true,
});
const request = {
  provider: "anthropic",
  label: "Team key",
  credential: "secret",
  replaceKeyId: null,
};

function makeStore(existingKey = false) {
  const store = configureStore({
    reducer: {
      auth: () => ({ currentOrganizationId: "org" }),
      agentProviders: agentProvidersReducer,
      agentRuntimeSettings: agentRuntimeSettingsReducer,
    },
  });
  store.dispatch(
    fetchProviderKeys.fulfilled(
      { organizationId: "org", keys: existingKey ? [providerKeyToPlain(key)] : [] },
      "seed",
      undefined,
    ),
  );
  return {
    store,
    dispatch: store.dispatch as AppDispatch,
    configuredProvider: () => selectConfiguredProvider(store.getState() as unknown as RootState),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.add.mockResolvedValue({ key });
  mocks.list.mockResolvedValue({ keys: [key] });
  mocks.models.mockResolvedValue({ models: [model] });
  mocks.runtime.mockResolvedValue({ settings: create(RuntimeSettingsSchema), configured: false });
  mocks.save.mockImplementation(async ({ settings }) => ({ settings, configured: true }));
});

it.each(["runtime", "models", "save"] as const)(
  "retries failed %s setup with the saved key before reporting readiness",
  async (failure) => {
    const { store, dispatch, configuredProvider } = makeStore();
    mocks[failure].mockRejectedValueOnce(new Error("Setup unavailable"));

    const result = await dispatch(connectProvider(request));
    expect(result).toEqual({ status: "failed", keyId: key.id });
    expect(configuredProvider()).toBeNull();
    if (result.status !== "failed" || !result.keyId) throw new Error("Missing retry key");

    const retry = await dispatch(connectProvider({ keyId: result.keyId }));
    expect(retry.status).toBe("connected");
    expect(configuredProvider()).toBe("anthropic");
    expect(mocks.add).toHaveBeenCalledOnce();
    expect(store.getState().agentRuntimeSettings.settings).toMatchObject({
      defaultProviderKeyId: key.id,
      defaultChatModel: model.id,
    });
  },
);

it("resumes model setup for an existing key after reload", async () => {
  const { dispatch, configuredProvider } = makeStore(true);
  expect(configuredProvider()).toBeNull();
  const result = await dispatch(connectProvider({ keyId: key.id }));
  expect(result.status).toBe("connected");
  expect(configuredProvider()).toBe("anthropic");
  expect(mocks.add).not.toHaveBeenCalled();
});

it("does not report readiness when the key has no compatible models", async () => {
  const { dispatch, configuredProvider } = makeStore();
  mocks.models.mockResolvedValue({ models: [] });
  expect(await dispatch(connectProvider(request))).toEqual({ status: "no_models", keyId: key.id });
  expect(configuredProvider()).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("finishes a partial default that names a key without a model", async () => {
  const { dispatch, configuredProvider } = makeStore(true);
  mocks.runtime.mockResolvedValue({
    settings: create(RuntimeSettingsSchema, { defaultProviderKeyId: key.id }),
    configured: true,
  });
  expect((await dispatch(connectProvider({ keyId: key.id }))).status).toBe("connected");
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(configuredProvider()).toBe("anthropic");
});
