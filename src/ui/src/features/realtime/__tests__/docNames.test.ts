import { describe, expect, it } from "vitest";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { docContentTypeName, docNameFor } from "@/features/realtime/docNames";

describe("docContentTypeName", () => {
  it.each([ContentType.NOTE, ContentType.TASK, ContentType.CALENDAR_EVENT])(
    "uses canonical enum name for %s",
    (type) => {
      expect(docContentTypeName(type)).toBe(ContentType[type]);
    },
  );
});

describe("docNameFor", () => {
  it("joins the backend enum name and id with one colon", () => {
    expect(docNameFor(docContentTypeName(ContentType.TASK), "abc")).toBe("TASK:abc");
  });
});
