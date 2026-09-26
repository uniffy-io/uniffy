import { describe, expect, it } from "vitest";
import { appPathForLink } from "@shared/lib/appLinks";

const SERVER = "https://acme.uniffy.io";

describe("appPathForLink", () => {
  it("opens a web view link on the project screen with the view", () => {
    expect(appPathForLink(`${SERVER}/projects/p1?view=view_abc`, SERVER)).toBe(
      "/projects/p1?view=view_abc",
    );
  });

  it("takes app scheme links and bare paths", () => {
    expect(appPathForLink("uniffy://projects/p1?view=v", SERVER)).toBe("/projects/p1?view=v");
    expect(appPathForLink("/projects/p1", SERVER)).toBe("/projects/p1");
  });

  it("leaves links to other hosts and unknown paths alone", () => {
    expect(appPathForLink("https://example.com/projects/p1", SERVER)).toBeNull();
    expect(appPathForLink(`${SERVER}/notes/n1`, SERVER)).toBeNull();
    expect(appPathForLink(`${SERVER}/projects/p1/settings`, SERVER)).toBeNull();
    expect(appPathForLink("not a url at all", "not an origin")).toBeNull();
  });
});
