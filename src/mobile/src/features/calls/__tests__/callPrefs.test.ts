import { beforeEach, describe, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
  },
}));

describe("call join preferences", () => {
  beforeEach(() => {
    storage.clear();
    vi.resetModules();
  });
  it("starts private when preferences are absent", async () => {
    const { getJoinMediaPreferences } = await import("@features/calls/callPrefs");
    expect(await getJoinMediaPreferences()).toEqual({ mic: false, camera: false, facing: "user" });
  });
  it("restores saved join defaults before opening setup", async () => {
    storage.set("uniffy_call_join_muted", "false");
    storage.set("uniffy_call_camera_on", "true");
    storage.set("uniffy_call_camera_facing", "environment");
    const { getJoinMediaPreferences } = await import("@features/calls/callPrefs");
    expect(await getJoinMediaPreferences()).toEqual({
      mic: true,
      camera: true,
      facing: "environment",
    });
  });
  it("uses private defaults for corrupt storage", async () => {
    storage.set("uniffy_call_join_muted", "bad");
    storage.set("uniffy_call_camera_on", "bad");
    storage.set("uniffy_call_camera_facing", "bad");
    const { getJoinMediaPreferences } = await import("@features/calls/callPrefs");
    expect(await getJoinMediaPreferences()).toEqual({ mic: false, camera: false, facing: "user" });
  });
});
