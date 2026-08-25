import { describe, expect, it, vi } from "vitest";
import { resolveUrnChunks } from "@/features/search/utils/urnResolutionChunks";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("resolveUrnChunks", () => {
  it("limits active requests and publishes each completed chunk", async () => {
    const controller = new AbortController();
    const resolved: string[] = [];
    let active = 0;
    let maxActive = 0;

    await resolveUrnChunks(
      Array.from({ length: 8 }, (_, index) => [`urn-${index}`]),
      {
        signal: controller.signal,
        concurrency: 3,
        resolve: async ([urn]) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await Promise.resolve();
          active -= 1;
          return urn;
        },
        onResolved: (urn) => resolved.push(urn),
      },
    );

    expect(maxActive).toBe(3);
    expect(new Set(resolved)).toEqual(new Set(Array.from({ length: 8 }, (_, i) => `urn-${i}`)));
  });

  it("publishes a response before slower chunks finish", async () => {
    const controller = new AbortController();
    const first = deferred<string>();
    const second = deferred<string>();
    const resolved: string[] = [];
    let completed = false;

    const pending = resolveUrnChunks([["first"], ["second"]], {
      signal: controller.signal,
      concurrency: 2,
      resolve: ([urn]) => (urn === "first" ? first.promise : second.promise),
      onResolved: (urn) => resolved.push(urn),
    }).finally(() => {
      completed = true;
    });

    first.resolve("first");
    await vi.waitFor(() => expect(resolved).toEqual(["first"]));
    expect(completed).toBe(false);

    second.resolve("second");
    await pending;
    expect(resolved).toEqual(["first", "second"]);
  });

  it("aborts active requests without starting more chunks", async () => {
    const controller = new AbortController();
    let started = 0;

    const pending = resolveUrnChunks(
      Array.from({ length: 6 }, (_, index) => [`urn-${index}`]),
      {
        signal: controller.signal,
        concurrency: 3,
        resolve: (_urns, signal) =>
          new Promise((_resolve, reject) => {
            started += 1;
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
        onResolved: () => undefined,
      },
    );

    await vi.waitFor(() => expect(started).toBe(3));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(started).toBe(3);
  });
});
