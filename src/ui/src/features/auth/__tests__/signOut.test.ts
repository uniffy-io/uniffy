import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  live: vi.fn(),
  discover: vi.fn(),
  teardown: vi.fn(),
  dispatch: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/app/hooks", () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (select: (state: unknown) => unknown) =>
    select({ auth: { user: { id: "user" } } }),
}));
vi.mock("@/config/api", () => ({ clearMemoryAccessToken: vi.fn(), unaryTransport: {} }));
vi.mock("@/features/auth/store/authSlice", () => ({ logout: () => ({ type: "logout" }) }));
vi.mock("@/features/files/components/viewer/hooks/blobCache", () => ({ clearBlobCache: vi.fn() }));
vi.mock("@/features/files/upload", () => ({ uploadService: { reset: vi.fn() } }));
vi.mock("@/features/library/store/clearLibraryScope", () => ({ clearLibraryScope: vi.fn() }));
vi.mock("@/features/notes/utils/notesCache", () => ({ clearAllCache: async () => {} }));
vi.mock("@/features/realtime", () => ({
  hasUnsyncedEdits: mocks.live,
  clearPendingDocsFor: vi.fn(),
}));
vi.mock("@/features/recording/store/recordingThunks", () => ({ cancelRecording: vi.fn() }));
vi.mock("@/shared/crypto/storageEncryption", () => ({ teardownStorageEncryption: mocks.teardown }));
vi.mock("@/features/realtime/persistence/encryptedYjsPersistence", () => ({
  discoverStoredPendingDocs: mocks.discover,
}));

import { useSignOut } from "@/features/auth/hooks/useSignOut";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.live.mockReturnValue(false);
  mocks.discover.mockResolvedValue(false);
});

describe("sign-out draft guard", () => {
  it.each(["live", "stored", "failed scan"])("keeps keys for %s edits", async (kind) => {
    if (kind === "live") mocks.live.mockReturnValue(true);
    if (kind === "stored") mocks.discover.mockResolvedValue(true);
    if (kind === "failed scan") mocks.discover.mockRejectedValue(new Error("storage unavailable"));
    expect(await useSignOut()()).toBe(false);
    expect(mocks.teardown).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("rechecks edits made during storage discovery", async () => {
    mocks.live.mockReturnValueOnce(false).mockReturnValue(true);
    expect(await useSignOut()()).toBe(false);
    expect(mocks.teardown).not.toHaveBeenCalled();
  });
  it("signs out after a clean scan", async () => {
    expect(await useSignOut()()).toBe(true);
    expect(mocks.teardown).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith("/auth");
  });
  it("honors explicit discard", async () => {
    mocks.live.mockReturnValue(true);
    expect(await useSignOut()({ discardUnsynced: true })).toBe(true);
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(mocks.teardown).toHaveBeenCalledOnce();
  });
});
