import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { create } from "@bufbuild/protobuf";
import { beforeEach, expect, it, vi } from "vitest";
import {
  FinishOnboardingResponseSchema,
  OnboardingStep,
} from "@uniffy/proto/organizations/v1/organizations_pb";
import type { AppDispatch } from "@/app/store";
import type { OnboardingShell } from "@/features/onboarding/components/OnboardingShell";
import type { LaunchStep } from "@/features/onboarding/components/steps/LaunchStep";
import { OnboardingPage } from "@/features/onboarding/pages/OnboardingPage";
import { onboardingReducer } from "@/features/onboarding/store/onboardingSlice";
import { fetchOnboarding, finishOnboarding } from "@/features/onboarding/store/onboardingThunks";

const mocks = vi.hoisted(() => ({
  finish: vi.fn(),
  navigate: vi.fn(),
  portal: vi.fn(),
  launch: null as ComponentProps<typeof LaunchStep> | null,
}));

vi.mock("@/config/api", () => ({ unaryTransport: {}, transport: {} }));
vi.mock("@/features/onboarding/api/onboardingApi", () => ({
  onboardingApi: { finish: mocks.finish },
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate, Navigate: () => null }));
vi.mock("@/shared/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/components/orbit/launch/launchCurtain", () => ({ enterThroughPortal: mocks.portal }));
vi.mock("@/features/onboarding/launch/destinations", () => ({ preloadDestination: vi.fn() }));
vi.mock("@/features/onboarding/scenes", () => ({ buildScene: vi.fn() }));
vi.mock("@/features/auth/store/organizationsThunks", () => ({ fetchMyOrganizations: vi.fn() }));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/features/onboarding/components/OnboardingShell", () => ({
  OnboardingShell: ({ children }: ComponentProps<typeof OnboardingShell>) => children,
}));
vi.mock("@/features/onboarding/components/steps/LaunchStep", () => ({
  LaunchStep: (props: ComponentProps<typeof LaunchStep>) => {
    mocks.launch = props;
    return null;
  },
}));
vi.mock("@/features/onboarding/components/steps/AgentsStep", () => ({ AgentsStep: () => null }));
vi.mock("@/features/onboarding/components/steps/AppearanceStep", () => ({
  AppearanceStep: () => null,
}));
vi.mock("@/features/onboarding/components/steps/MentionDisplayStep", () => ({
  MentionDisplayStep: () => null,
}));
vi.mock("@/features/onboarding/components/steps/MentionsStep", () => ({
  MentionsStep: () => null,
}));
vi.mock("@/features/onboarding/components/steps/SharingStep", () => ({ SharingStep: () => null }));
vi.mock("@/features/onboarding/components/steps/TeamStep", () => ({ TeamStep: () => null }));
vi.mock("@/features/onboarding/components/steps/WelcomeStep", () => ({ WelcomeStep: () => null }));

const completed = create(FinishOnboardingResponseSchema, {
  state: { pending: false, currentStep: OnboardingStep.LAUNCH },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeStore() {
  const store = configureStore({
    reducer: {
      auth: () => ({
        currentOrganizationId: "org",
        currentOrganizationSlug: "team",
        currentOrganizationRole: "OWNER",
      }),
      organizations: () => ({ items: [], status: "ready" }),
      admin: () => ({ permissionDefaults: [] }),
      settings: () => ({ effectiveSettings: null }),
      agentProviders: () => ({ organizationId: "org", providerKeys: {} }),
      agentRuntimeSettings: () => ({ settings: null }),
      onboarding: onboardingReducer,
    },
  });
  store.dispatch(
    fetchOnboarding.fulfilled({ pending: true, currentStep: "launch" }, "seed", "org"),
  );
  return store;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.portal.mockResolvedValue(undefined);
});

it.each([false, true])(
  "keeps failed completion pending for retry, dismissed=%s",
  async (dismissed) => {
    const store = makeStore();
    const dispatch = store.dispatch as AppDispatch;
    mocks.finish
      .mockRejectedValueOnce(new Error("Service unavailable"))
      .mockResolvedValueOnce(completed);

    const first = dispatch(finishOnboarding({ organizationId: "org", dismissed }));
    expect(store.getState().onboarding.byOrganization.org.pending).toBe(true);
    await expect(first.unwrap()).rejects.toBe("Service unavailable");
    expect(store.getState().onboarding.byOrganization.org.pending).toBe(true);

    await dispatch(finishOnboarding({ organizationId: "org", dismissed })).unwrap();
    expect(store.getState().onboarding.byOrganization.org.pending).toBe(false);
  },
);

it("keeps the page in place until completion succeeds", async () => {
  const store = makeStore();
  const render = () => {
    renderToStaticMarkup(
      createElement(Provider, { store, children: createElement(OnboardingPage) }),
    );
    if (!mocks.launch) throw new Error("Launch step missing");
    return mocks.launch;
  };
  const failed = deferred<typeof completed>();
  mocks.finish.mockReturnValueOnce(failed.promise);
  const first = render().onLaunch("/chat");
  expect(mocks.portal).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();

  failed.reject(new Error("Service unavailable"));
  await first;
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(mocks.portal).not.toHaveBeenCalled();
  expect(store.getState().onboarding.byOrganization.org.pending).toBe(true);

  const succeeded = deferred<typeof completed>();
  mocks.finish.mockReturnValueOnce(succeeded.promise);
  const retry = render().onLaunch("/chat");
  expect(mocks.navigate).not.toHaveBeenCalled();
  succeeded.resolve(completed);
  await retry;

  expect(mocks.portal).toHaveBeenCalledOnce();
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/chat", { replace: true });
  expect(store.getState().onboarding.byOrganization.org.pending).toBe(false);
});
