import { describe, expect, it } from "vitest";
import { parseIntegrationConnections } from "@/features/agents/utils/integrationConnections";

describe("parseIntegrationConnections", () => {
  it("parses a provider to connection map", () => {
    expect(parseIntegrationConnections('{"github":"c1"}')).toEqual({ github: "c1" });
  });

  it("treats empty and blank objects as automatic", () => {
    expect(parseIntegrationConnections("")).toEqual({});
    expect(parseIntegrationConnections("{}")).toEqual({});
  });

  it("returns empty on malformed payloads", () => {
    expect(parseIntegrationConnections("not json")).toEqual({});
    expect(parseIntegrationConnections("[1,2]")).toEqual({});
    expect(parseIntegrationConnections('"github"')).toEqual({});
    expect(parseIntegrationConnections("null")).toEqual({});
  });

  it("drops non-string and empty pin values", () => {
    expect(parseIntegrationConnections('{"github":"c1","gitlab":7,"jira":""}')).toEqual({
      github: "c1",
    });
  });

  it("round-trips the update payload shape", () => {
    const pins = { github: "c1", gitlab: "c2" };
    expect(parseIntegrationConnections(JSON.stringify(pins))).toEqual(pins);
  });
});
