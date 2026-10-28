import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import {
  readTabOrganization,
  writeTabOrganization,
} from "@/features/auth/store/tabOrganizationStorage";

const harness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  pending: null as { organizationId: string; expected?: boolean } | null,
  dispatch: vi.fn(),
  clearLibrary: vi.fn(),
  clearBlobs: vi.fn(),
  purgeOrganization: vi.fn().mockResolvedValue(undefined),
  resetUploads: vi.fn(),
  clearNotes: vi.fn().mockResolvedValue(undefined),
  clearRecents: vi.fn(),
  clearTaskPages: vi.fn(),
  warning: vi.fn(),
  organizationId: "org-b",
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => void | (() => void)) => {
    harness.effects.push(effect);
  },
}));
vi.mock("@/app/hooks", () => ({
  useAppDispatch: () => harness.dispatch,
  useAppSelector: (select: (state: unknown) => unknown) =>
    select({
      auth: {
        user: { id: "alice" },
        isAuthenticated: true,
        currentOrganizationId: harness.organizationId,
      },
      settings: { initialized: true },
    }),
}));
vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/" }),
  Navigate: () => null,
}));
vi.mock("sonner", () => ({ toast: { warning: harness.warning } }));
vi.mock("@/config/api", () => ({
  ORGANIZATION_LOST_EVENT: "uniffy:auth:org-lost",
  takePendingOrganizationLost: () => {
    const pending = harness.pending;
    harness.pending = null;
    return pending;
  },
  unaryTransport: {},
}));
vi.mock("@/features/projects/hooks/useAssignedTasks", () => ({
  clearRequestedTaskPages: harness.clearTaskPages,
}));
vi.mock("@/features/realtime/hooks/useRealtimeDrain", () => ({ useRealtimeDrain: () => {} }));
vi.mock("@/features/onboarding/hooks/useOnboardingRedirect", () => ({
  ONBOARDING_PATH: "/onboarding",
  useOnboardingRedirect: () => false,
}));
vi.mock("@/features/settings", () => ({ fetchEffectiveSettings: vi.fn() }));
vi.mock("@/features/realtime", () => ({}));
vi.mock("@/features/recording/store/recordingThunks", () => ({}));
vi.mock("@/features/library/store/clearLibraryScope", () => ({
  clearLibraryScope: harness.clearLibrary,
}));
vi.mock("@/features/files/components/viewer/hooks/blobCache", () => ({
  clearBlobCache: harness.clearBlobs,
}));
vi.mock("@/features/files/upload", () => ({
  uploadService: {
    purgeOrganization: harness.purgeOrganization,
    resetForScope: harness.resetUploads,
  },
}));
vi.mock("@/features/notes/utils/notesCache", () => ({ clearCachedNotes: harness.clearNotes }));
vi.mock("@/features/search/utils/recentItems", () => ({
  clearRecentItemsForOrganization: harness.clearRecents,
}));

let dispose: Array<() => void> = [];

beforeEach(() => {
  vi.clearAllMocks();
  harness.effects = [];
  harness.pending = { organizationId: "org-a" };
  harness.organizationId = "org-b";
  vi.stubGlobal("window", new EventTarget());
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  });
});

afterEach(() => {
  for (const close of dispose.splice(0)) close();
  vi.unstubAllGlobals();
});

function mount() {
  ProtectedRoute({ children: null });
  for (const effect of harness.effects.splice(0)) {
    const cleanup = effect();
    if (cleanup) dispose.push(cleanup);
  }
}

it("cleans a lost organization's device stores after entering another organization", () => {
  writeTabOrganization("alice", { id: "org-b", slug: "b" });
  const event = vi.fn();
  window.addEventListener("uniffy:auth:org-lost", event);
  mount();

  expect(harness.pending).toBeNull();
  expect(event).toHaveBeenCalledOnce();
  expect(harness.purgeOrganization).toHaveBeenCalledWith("org-a", "alice");
  expect(harness.clearNotes).toHaveBeenCalledWith("org-a");
  expect(harness.clearRecents).toHaveBeenCalledWith("org-a", "alice");
  expect(harness.clearLibrary).not.toHaveBeenCalled();
  expect(harness.clearBlobs).not.toHaveBeenCalled();
  expect(harness.clearTaskPages).not.toHaveBeenCalled();
  expect(harness.resetUploads).not.toHaveBeenCalled();
  expect(readTabOrganization("alice")?.id).toBe("org-b");
  expect(harness.warning).toHaveBeenCalledOnce();
});

it("clears memory and tab identity when the lost organization is still current", () => {
  harness.organizationId = "org-a";
  writeTabOrganization("alice", { id: "org-a", slug: "a" });
  mount();
  expect(harness.clearLibrary).toHaveBeenCalledOnce();
  expect(harness.clearBlobs).toHaveBeenCalledOnce();
  expect(harness.clearTaskPages).toHaveBeenCalledOnce();
  expect(harness.purgeOrganization).toHaveBeenCalledWith("org-a", "alice");
  expect(readTabOrganization("alice")).toBeNull();
});

it("cleans up without the warning when the user left the organization from this tab", () => {
  harness.pending = { organizationId: "org-a", expected: true };
  writeTabOrganization("alice", { id: "org-b", slug: "b" });
  mount();

  expect(harness.purgeOrganization).toHaveBeenCalledWith("org-a", "alice");
  expect(harness.clearRecents).toHaveBeenCalledWith("org-a", "alice");
  expect(harness.warning).not.toHaveBeenCalled();
});
