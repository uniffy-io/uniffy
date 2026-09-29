import { create } from "@bufbuild/protobuf";
import { UrnAvailability, UrnMetadataSchema } from "@uniffy/proto/search/v1/search_pb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveUrns: vi.fn() }));
vi.mock("@/features/search/api/searchApi", () => ({
  searchApi: { resolveUrns: mocks.resolveUrns },
}));

import { resolveMentionBatch } from "@/components/mention/resolveMentionBatch";

describe("mention batch resolution", () => {
  beforeEach(() => {
    mocks.resolveUrns.mockReset();
  });

  it("settles omitted references without changing authoritative availability", async () => {
    const available = create(UrnMetadataSchema, {
      title: "Hack day",
      availability: UrnAvailability.AVAILABLE,
    });
    const restricted = create(UrnMetadataSchema, {
      availability: UrnAvailability.RESTRICTED,
      canRequestAccess: true,
    });
    const deleted = create(UrnMetadataSchema, { availability: UrnAvailability.DELETED });
    mocks.resolveUrns.mockResolvedValue({ resolved: { available, restricted, deleted } });

    const result = await resolveMentionBatch("org", [
      "available",
      "restricted",
      "deleted",
      "missing",
    ]);

    expect(result.available).toBe(available);
    expect(result.restricted).toBe(restricted);
    expect(result.deleted).toBe(deleted);
    expect(result.missing).toMatchObject({
      availability: UrnAvailability.UNAVAILABLE,
      canRequestAccess: false,
      title: "",
      metadata: {},
    });
  });

  it("settles failed lookups as unavailable", async () => {
    mocks.resolveUrns.mockRejectedValue(new Error("Network unavailable"));

    const result = await resolveMentionBatch("org", ["first", "second"]);

    expect(Object.keys(result)).toEqual(["first", "second"]);
    for (const metadata of Object.values(result)) {
      expect(metadata.availability).toBe(UrnAvailability.UNAVAILABLE);
      expect(metadata.canRequestAccess).toBe(false);
    }
  });

  it("deduplicates and chunks large batches while preserving successful chunks", async () => {
    const urns = Array.from({ length: 201 }, (_, i) => `urn-${i}`);
    mocks.resolveUrns.mockImplementation(async ({ urns: chunk }: { urns: string[] }) => {
      if (chunk.includes("urn-100")) throw new Error("Chunk failed");
      return {
        resolved: Object.fromEntries(
          chunk.map((urn) => [
            urn,
            create(UrnMetadataSchema, {
              title: urn,
              availability: UrnAvailability.AVAILABLE,
            }),
          ]),
        ),
      };
    });

    const result = await resolveMentionBatch("org", [...urns, urns[0]]);

    expect(mocks.resolveUrns.mock.calls.map(([request]) => request.urns.length)).toEqual([
      100, 100, 1,
    ]);
    expect(Object.keys(result)).toHaveLength(201);
    for (const [i, urn] of urns.entries()) {
      expect(result[urn].availability).toBe(
        i >= 100 && i < 200 ? UrnAvailability.UNAVAILABLE : UrnAvailability.AVAILABLE,
      );
    }
  });
});
