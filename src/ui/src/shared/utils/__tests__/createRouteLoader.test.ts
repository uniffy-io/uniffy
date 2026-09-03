import { describe, expect, it, vi } from "vitest";
import { createRouteLoader } from "@/shared/utils/createRouteLoader";

describe("createRouteLoader", () => {
  it("shares one in-flight import across preload and navigation", async () => {
    const module = { Page: () => null };
    const factory = vi.fn().mockResolvedValue(module);
    const loader = createRouteLoader(factory);

    loader.preload();
    await expect(loader.load()).resolves.toBe(module);

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("allows a failed import to be retried", async () => {
    const module = { Page: () => null };
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce(module);
    const loader = createRouteLoader(factory);

    await expect(loader.load()).rejects.toThrow("chunk unavailable");
    await expect(loader.load()).resolves.toBe(module);

    expect(factory).toHaveBeenCalledTimes(2);
  });
});
