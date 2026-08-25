import { describe, expect, it } from "vitest";
import { AccessMode, ContentType } from "@uniffy/proto/common/v1/common_pb";

import {
  criteriaEquals,
  isCriteriaEmpty,
  readLibraryTagFilterCriteria,
  sanitizeLibraryTagFilterParams,
} from "@/features/tags/hooks/useTagFilterState";
import { criteriaToPlain, criteriaToProto, emptyCriteria } from "@/features/tags/store/tagsThunks";
import { create } from "@bufbuild/protobuf";
import { TagFilterCriteriaSchema } from "@uniffy/proto/tags/v1/tags_pb";

describe("useTagFilterState helpers", () => {
  it("isCriteriaEmpty recognises a fresh emptyCriteria", () => {
    expect(isCriteriaEmpty(emptyCriteria())).toBe(true);
  });

  it("criteriaEquals true for two equal criteria", () => {
    const a = { ...emptyCriteria(), tagIds: ["a", "b"] };
    const b = { ...emptyCriteria(), tagIds: ["a", "b"] };
    expect(criteriaEquals(a, b)).toBe(true);
  });

  it("criteriaEquals true for permuted tag id arrays", () => {
    const a = { ...emptyCriteria(), tagIds: ["a", "b"] };
    const b = { ...emptyCriteria(), tagIds: ["b", "a"] };
    expect(criteriaEquals(a, b)).toBe(true);
  });

  it("criteriaEquals false when source set differs", () => {
    const a = { ...emptyCriteria(), sources: ["manual" as const] };
    const b = { ...emptyCriteria(), sources: ["inline" as const] };
    expect(criteriaEquals({ ...a }, { ...b })).toBe(false);
  });
});

describe("Library tag URL filters", () => {
  it("reads only the visible content-type criterion", () => {
    const criteria = readLibraryTagFilterCriteria(
      new URLSearchParams({
        types: String(ContentType.NOTE),
        tags: "tag-1",
        owners: "user-1",
        sources: "manual",
        createdAfter: "2026-01-01T00:00:00.000Z",
        access: String(AccessMode.OPEN_TO_ORG),
        untagged: "1",
      }),
    );

    expect(criteria).toEqual({
      ...emptyCriteria(),
      contentTypes: [ContentType.NOTE],
    });
  });

  it("converts legacy domain links and removes invisible criteria", () => {
    const sanitized = sanitizeLibraryTagFilterParams(
      new URLSearchParams({
        domain: "file",
        tags: "tag-1",
        owners: "user-1",
        sources: "inline",
        createdBefore: "2026-12-31T00:00:00.000Z",
        updatedAfter: "2026-06-01T00:00:00.000Z",
        access: String(AccessMode.OWNER_ONLY),
        untagged: "1",
        keep: "yes",
      }),
    );

    expect(sanitized.get("types")).toBe(String(ContentType.FILE));
    expect(sanitized.get("domain")).toBeNull();
    expect(sanitized.get("tags")).toBeNull();
    expect(sanitized.get("owners")).toBeNull();
    expect(sanitized.get("sources")).toBeNull();
    expect(sanitized.get("createdBefore")).toBeNull();
    expect(sanitized.get("updatedAfter")).toBeNull();
    expect(sanitized.get("access")).toBeNull();
    expect(sanitized.get("untagged")).toBeNull();
    expect(sanitized.get("keep")).toBe("yes");
  });
});

describe("criteria proto round trip", () => {
  it("serialises and deserialises every field", () => {
    const original = {
      ...emptyCriteria(),
      tagIds: ["a", "b"],
      contentTypes: [ContentType.NOTE, ContentType.FILE],
      ownerIds: ["user-1"],
      sources: ["manual" as const],
      createdAfter: "2026-01-01T00:00:00.000Z",
      createdBefore: "2026-12-31T00:00:00.000Z",
      updatedAfter: null,
      updatedBefore: null,
      accessMode: AccessMode.OPEN_TO_ORG,
      untaggedOnly: false,
    };
    const proto = create(TagFilterCriteriaSchema, criteriaToProto(original));
    const back = criteriaToPlain(proto);
    expect(back.tagIds).toEqual(original.tagIds);
    expect(back.contentTypes).toEqual(original.contentTypes);
    expect(back.ownerIds).toEqual(original.ownerIds);
    expect(back.sources).toEqual(original.sources);
    expect(back.accessMode).toBe(AccessMode.OPEN_TO_ORG);
    expect(back.untaggedOnly).toBe(false);
    expect(back.createdAfter).toBe(original.createdAfter);
    expect(back.createdBefore).toBe(original.createdBefore);
  });

  it("preserves untaggedOnly through the round trip", () => {
    const original = { ...emptyCriteria(), untaggedOnly: true };
    const proto = create(TagFilterCriteriaSchema, criteriaToProto(original));
    const back = criteriaToPlain(proto);
    expect(back.untaggedOnly).toBe(true);
  });
});
