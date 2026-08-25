import { describe, expect, it } from "vitest";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { UrnType } from "@/shared/utils/urnTypes";
import {
  bookmarkTypesToContentTypes,
  parseBookmarkTypesParam,
  serializeBookmarkTypesParam,
} from "@/features/bookmarks/utils/bookmarkTypes";

describe("bookmark type URL parameter", () => {
  it("round-trips known types", () => {
    const types = [UrnType.CHAT_MESSAGE, UrnType.NOTE];
    expect(parseBookmarkTypesParam(serializeBookmarkTypesParam(types))).toEqual(types);
  });

  it("drops unknown and duplicate values", () => {
    expect(parseBookmarkTypesParam("chat_message,unknown,chat_message, note ,nonsense")).toEqual([
      UrnType.CHAT_MESSAGE,
      UrnType.NOTE,
    ]);
  });

  it("returns no filters for an absent parameter", () => {
    expect(parseBookmarkTypesParam(null)).toEqual([]);
    expect(parseBookmarkTypesParam("")).toEqual([]);
  });

  it("maps filter types onto the proto content types", () => {
    expect(bookmarkTypesToContentTypes([UrnType.CHAT_MESSAGE, UrnType.CALENDAR_EVENT])).toEqual([
      ContentType.CHAT_MESSAGE,
      ContentType.CALENDAR_EVENT,
    ]);
  });
});
