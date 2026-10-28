import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { beforeEach, expect, it, vi } from "vitest";
import { AccessMode, ContentRole, ContentType } from "@uniffy/proto/common/v1/common_pb";
import { adminReducer } from "@/features/admin/store/adminSlice";
import { fetchPermissionDefaults } from "@/features/admin/store/adminThunks";
import { SharingStep } from "@/features/onboarding/components/steps/SharingStep";
import type { StepActions, StepFrame } from "@/features/onboarding/components/StepFrame";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  get: vi.fn(),
  actions: null as ComponentProps<typeof StepActions> | null,
}));

vi.mock("@/config/api", () => ({ unaryTransport: {}, transport: {} }));
vi.mock("@/features/admin/api/adminApi", () => ({
  adminApi: { updatePermissionDefaults: mocks.update, getPermissionDefaults: mocks.get },
}));
vi.mock("@/features/onboarding/components/StepFrame", () => ({
  StepFrame: ({ actions }: ComponentProps<typeof StepFrame>) => actions,
  StepActions: (props: ComponentProps<typeof StepActions>) => {
    mocks.actions = props;
    return null;
  },
  Eyebrow: () => null,
}));

const defaults = [ContentType.NOTE, ContentType.PROJECT].map((contentType) => ({
  contentType,
  defaultAccessMode: AccessMode.OPEN_TO_ORG,
  defaultBaselineRole: ContentRole.EDITOR,
  updatedAt: null,
}));

function renderStep(loaded = true) {
  const store = configureStore({
    reducer: { auth: () => ({ currentOrganizationId: "org" }), admin: adminReducer },
  });
  if (loaded) store.dispatch(fetchPermissionDefaults.fulfilled(defaults, "seed", undefined));
  const next = vi.fn();
  const render = () => {
    renderToStaticMarkup(
      createElement(Provider, {
        store,
        children: createElement(SharingStep, {
          preset: "view",
          onPresetChange: vi.fn(),
          onNext: next,
          onBack: vi.fn(),
        }),
      }),
    );
    if (!mocks.actions) throw new Error("Step actions missing");
    return mocks.actions;
  };
  return { store, next, render };
}

beforeEach(() => vi.resetAllMocks());

it("retries only failed sharing writes before continuing", async () => {
  const { store, next, render } = renderStep();
  mocks.update
    .mockImplementationOnce(async (args) => ({ defaults: args }))
    .mockRejectedValueOnce(new Error("Project save failed"))
    .mockImplementationOnce(async (args) => ({ defaults: args }));

  await render().onPrimary();
  expect(next).not.toHaveBeenCalled();
  const retry = render();
  expect(retry.primaryLabel).toBe("Save and continue");
  await retry.onPrimary();

  expect(mocks.update.mock.calls.map(([args]) => args.contentType)).toEqual([
    ContentType.NOTE,
    ContentType.PROJECT,
    ContentType.PROJECT,
  ]);
  expect(next).toHaveBeenCalledOnce();
  expect(
    store.getState().admin.permissionDefaults.map((entry) => entry.defaultBaselineRole),
  ).toEqual([ContentRole.VIEWER, ContentRole.VIEWER]);
});

it("waits for defaults instead of treating unloaded settings as saved", () => {
  const { render, next } = renderStep(false);
  expect(render().primaryDisabled).toBe(true);
  expect(render().primaryLabel).toBe("Loading settings");
  expect(next).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});

it("retries a failed settings read before saving the selected preset", async () => {
  const { store, render, next } = renderStep(false);
  store.dispatch(fetchPermissionDefaults.rejected(new Error("Read failed"), "read", undefined));
  mocks.get.mockResolvedValue({ defaults });
  const retry = render();
  expect(retry.primaryLabel).toBe("Retry settings");
  expect(retry.primaryDisabled).toBe(false);
  await retry.onPrimary();
  expect(mocks.get).toHaveBeenCalledOnce();
  expect(render().primaryLabel).toBe("Save and continue");
  expect(next).not.toHaveBeenCalled();
});
