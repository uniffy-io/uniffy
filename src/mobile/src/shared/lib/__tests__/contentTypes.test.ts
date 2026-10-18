import { describe, expect, it } from "vitest";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import {
  contentTypeLabel,
  domainForType,
  nativeRouteFor,
  urnTypeOf,
} from "@shared/lib/contentTypes";

describe("calendar references", () => {
  it("recognizes calendars separately from events", () => {
    expect(urnTypeOf("urn:uniffy:content:CALENDAR:c1")).toBe("CALENDAR");
    expect(contentTypeLabel(SearchResultType.CALENDAR)).toBe("Calendar");
    expect(domainForType(SearchResultType.CALENDAR)).toBe("calendar");
    expect(nativeRouteFor(SearchResultType.CALENDAR, "c1")).toBe("/calendar?calendar=c1");
    expect(nativeRouteFor(SearchResultType.CALENDAR_EVENT, "e1")).toBe("/calendar/e1");
  });
});
