import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { ResolveUrnsResponseSchema, UrnAvailability } from "@uniffy/proto/search/v1/search_pb";
import { resolveTaskLabels, taskUrn } from "@features/projects/taskLabels";

describe("resolveTaskLabels", () => {
  it("resolves more than 100 tasks in bounded sequential batches", async () => {
    const ids = Array.from({ length: 205 }, (_, index) => `task-${index}`);
    let active = 0;
    const resolve = vi.fn(async (request) => {
      expect(active++).toBe(0);
      await Promise.resolve();
      active--;
      return create(ResolveUrnsResponseSchema, {
        resolved: Object.fromEntries(
          request.urns.map((urn: string) => [
            urn,
            {
              availability: UrnAvailability.AVAILABLE,
              title: urn,
              projectSlug: "proj",
              taskNumber: 1,
            },
          ]),
        ),
      });
    });
    const signal = new AbortController().signal;
    const labels = await resolveTaskLabels("org", [...ids, ids[0]], resolve, signal);
    expect(resolve.mock.calls.map(([request]) => request.urns.length)).toEqual([100, 100, 5]);
    expect(Object.keys(labels)).toHaveLength(205);
    expect(labels[ids[204]]).toEqual({ title: taskUrn(ids[204]), code: "PROJ-1" });
    expect(resolve).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: "org" }), {
      signal,
    });
  });

  it("omits revoked and deleted metadata even if it carries a stale title", async () => {
    const resolve = vi.fn().mockResolvedValue(
      create(ResolveUrnsResponseSchema, {
        resolved: {
          [taskUrn("revoked")]: { availability: UrnAvailability.UNAVAILABLE, title: "private" },
          [taskUrn("deleted")]: { availability: UrnAvailability.DELETED, title: "deleted title" },
          [taskUrn("live")]: { availability: UrnAvailability.AVAILABLE, title: "Visible" },
        },
      }),
    );
    expect(
      await resolveTaskLabels("org", ["revoked", "deleted", "live", "missing"], resolve),
    ).toEqual({ live: { title: "Visible", code: null } });
  });

  it("stops before another batch when canceled", async () => {
    const controller = new AbortController();
    const resolve = vi.fn(async () => {
      controller.abort();
      return create(ResolveUrnsResponseSchema);
    });
    await expect(
      resolveTaskLabels(
        "org",
        Array.from({ length: 101 }, (_, i) => `${i}`),
        resolve,
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
