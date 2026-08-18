import { describe, expect, it } from "vitest";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { contentAccessUrn } from "@/features/notifications/contentAccessEmitter";

describe("contentAccessUrn", () => {
  it("builds the canonical content URN used by mention resolution", () => {
    expect(
      contentAccessUrn({
        contentType: ContentType.NOTE,
        contentId: "019fc01f-12b6-7f11-a7f1-a3197c6cefca",
        action: "revoked",
      }),
    ).toBe("urn:uniffy:content:NOTE:019fc01f-12b6-7f11-a7f1-a3197c6cefca");
  });

  it("does not construct a URN for an unspecified content type", () => {
    expect(
      contentAccessUrn({
        contentType: ContentType.UNSPECIFIED,
        contentId: "019fc01f-12b6-7f11-a7f1-a3197c6cefca",
        action: "revoked",
      }),
    ).toBeNull();
  });
});
