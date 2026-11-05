import { describe, expect, it } from "vitest";
import { orderPickerRows, type PickerPinnedRow } from "@shared/directory/pickerRows";
import type { DirectorySubject } from "@shared/directory/useDirectory";

const person = (id: string): DirectorySubject => ({ id, kind: "USER", name: id });
const me: PickerPinnedRow = {
  id: "assign-to-me",
  label: "Assign to me",
  selected: false,
  subjectId: "me",
  onPress: () => undefined,
};

describe("orderPickerRows", () => {
  it("lists picks first, then suggestions in server order without repeating anyone", () => {
    const rows = orderPickerRows({
      selectedIds: ["carol"],
      resolveSelected: (id) => person(id),
      results: [person("eve"), person("carol"), person("alice"), person("eve")],
      pinned: [],
      searching: false,
    });
    expect(rows.selected.map((s) => s.id)).toEqual(["carol"]);
    expect(rows.rest.map((s) => s.id)).toEqual(["eve", "alice"]);
  });

  it("keeps the person behind a pinned row out of both lists", () => {
    const rows = orderPickerRows({
      selectedIds: ["me", "bob"],
      resolveSelected: (id) => person(id),
      results: [person("me"), person("dan")],
      pinned: [me],
      searching: false,
    });
    expect(rows.selected.map((s) => s.id)).toEqual(["bob"]);
    expect(rows.rest.map((s) => s.id)).toEqual(["dan"]);
  });

  it("resolves picks that are not among the suggestions and skips unknown ones", () => {
    const rows = orderPickerRows({
      selectedIds: ["far", "ghost"],
      resolveSelected: (id) => (id === "far" ? person("far") : undefined),
      results: [person("alice")],
      pinned: [],
      searching: false,
    });
    expect(rows.selected.map((s) => s.id)).toEqual(["far"]);
  });

  it("keeps the server ranking untouched while searching", () => {
    const rows = orderPickerRows({
      selectedIds: ["bob"],
      resolveSelected: (id) => person(id),
      results: [person("eve"), person("bob")],
      pinned: [me],
      searching: true,
    });
    expect(rows.selected).toEqual([]);
    expect(rows.rest.map((s) => s.id)).toEqual(["eve", "bob"]);
  });
});
