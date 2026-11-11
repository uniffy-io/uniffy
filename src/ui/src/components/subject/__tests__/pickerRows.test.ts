import { describe, expect, it } from "vitest";
import { buildPickerRows, filterPickerSections } from "@/components/subject/pickerRows";
import { SUBJECT_TYPE, type Subject } from "@/components/subject/types";

const person = (id: string): Subject => ({ id, type: SUBJECT_TYPE.USER, name: id });
const me = { id: "u-me", username: "me", fullName: "Me Person", email: "me@x.io" };

const base = {
  currentUser: me,
  subjectTypes: "all" as const,
  excludeIds: [] as string[],
  pinnedOptions: [] as { id: string; subjectId?: string }[],
  value: [] as string[],
  resolvedSelected: [] as Subject[],
  results: [] as Subject[],
  suggested: true,
};

describe("buildPickerRows", () => {
  it("offers the caller first and never lists them again below", () => {
    const rows = buildPickerRows({
      ...base,
      value: ["u-me", "carol"],
      resolvedSelected: [person("u-me"), person("carol")],
      results: [person("u-me"), person("eve")],
    });
    expect(rows.self?.name).toBe("Me Person");
    expect(rows.selectedRows.map((s) => s.id)).toEqual(["carol"]);
    expect(rows.suggestions.map((s) => s.id)).toEqual(["eve"]);
  });

  it("drops the Me row where the caller is excluded or a caller row already stands for them", () => {
    expect(buildPickerRows({ ...base, excludeIds: ["u-me"] }).self).toBeNull();
    expect(buildPickerRows({ ...base, subjectTypes: "groups" }).self).toBeNull();
    const assign = buildPickerRows({
      ...base,
      pinnedOptions: [{ id: "assign-to-me", subjectId: "u-me" }],
      value: ["u-me"],
      resolvedSelected: [person("u-me")],
    });
    expect(assign.self).toBeNull();
    expect(assign.selectedRows).toEqual([]);
    expect(buildPickerRows({ ...base, currentUser: null }).self).toBeNull();
  });

  it("keeps suggestions out of search results", () => {
    const rows = buildPickerRows({ ...base, suggested: false, results: [person("eve")] });
    expect(rows.suggestions).toEqual([]);
  });
  it("keeps server metadata when selected person is outside cached member page", () => {
    const full = { ...person("outside-page"), name: "Known colleague", avatarUrl: "/avatar" };
    const rows = buildPickerRows({
      ...base,
      value: [full.id],
      resolvedSelected: [{ ...person(full.id), name: "abcdef" }],
      results: [full],
    });
    expect(rows.selectedRows).toEqual([full]);
    expect(rows.suggestions).toEqual([]);
  });
});

describe("filterPickerSections", () => {
  const agents = {
    id: "agents",
    label: "Agents",
    rows: [
      { id: "a1", subject: { id: "a1", type: SUBJECT_TYPE.AGENT, name: "Writer" } },
      { id: "a2", subject: { id: "a2", type: SUBJECT_TYPE.AGENT, name: "Reviewer" } },
    ],
  };

  it("keeps every row while nothing is typed", () => {
    expect(filterPickerSections([agents], "  ")[0].rows).toHaveLength(2);
  });

  it("matches names case-insensitively and drops sections that end up empty", () => {
    expect(filterPickerSections([agents], "WRI")[0].rows.map((row) => row.id)).toEqual(["a1"]);
    expect(filterPickerSections([agents], "nobody")).toEqual([]);
  });
});
