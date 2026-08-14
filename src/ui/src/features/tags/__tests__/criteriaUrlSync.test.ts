/**
 * Round-trip test for the criteria <-> URL serializer used by
 * ``useTagFilterState``. The hook itself ties into ``useSearchParams``;
 * this test exercises the pure encode/decode helpers via the public
 * functions exposed by the file.
 */

import { describe, expect, it } from "vitest";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";

import { criteriaEquals, isCriteriaEmpty } from "@/features/tags/hooks/useTagFilterState";
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
