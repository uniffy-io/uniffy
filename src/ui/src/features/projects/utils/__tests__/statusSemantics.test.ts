import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATUS_OPTIONS,
  SYSTEM_FIELD_IDS,
  type FieldDefinition,
  type SelectOption,
} from "@/features/projects/types/fields";
import {
  isCompletedStatus,
  isRequiredStatusOption,
  statusIdForSemantic,
  statusOptionsOf,
  statusSemanticOf,
} from "@/features/projects/utils/statusSemantics";

function option(id: string, overrides: Partial<SelectOption> = {}): SelectOption {
  return { id, label: id, color: "", sortOrder: 0, ...overrides };
}

function statusField(options: SelectOption[]): FieldDefinition {
  return {
    id: SYSTEM_FIELD_IDS.STATUS,
    projectId: "proj-1",
    name: "Status",
    type: "single_select",
    isRequired: true,
    isSystem: true,
    sortOrder: 0,
    config: { options },
    createdAt: "",
    updatedAt: "",
  };
}

const CUSTOM: SelectOption[] = [
  option("status_backlog", { semantic: "todo" }),
  option("status_doing", { semantic: "in_progress" }),
  option("status_done", { semantic: "review" }),
  option("status_shipped", { semantic: "completed" }),
];

describe("statusSemanticOf", () => {
  it("prefers the stored semantic over the legacy id", () => {
    expect(statusSemanticOf(option("status_done", { semantic: "review" }))).toBe("review");
  });

  it("falls back to the legacy table when no semantic is stored", () => {
    expect(statusSemanticOf(option("status_done"))).toBe("completed");
    expect(statusSemanticOf(option("status_in_progress"))).toBe("in_progress");
  });

  it("returns null for an unknown id without a semantic", () => {
    expect(statusSemanticOf(option("status_blocked"))).toBeNull();
  });
});

describe("statusIdForSemantic", () => {
  it("finds a custom completed status", () => {
    expect(statusIdForSemantic(CUSTOM, "completed")).toBe("status_shipped");
    expect(statusIdForSemantic(CUSTOM, "todo")).toBe("status_backlog");
  });

  it("returns null when no option carries the semantic", () => {
    expect(statusIdForSemantic([option("status_blocked")], "completed")).toBeNull();
  });
});

describe("isCompletedStatus", () => {
  it("follows the semantic, not the id", () => {
    expect(isCompletedStatus(CUSTOM, "status_shipped")).toBe(true);
    expect(isCompletedStatus(CUSTOM, "status_done")).toBe(false);
  });

  it("is false for a missing status", () => {
    expect(isCompletedStatus(CUSTOM, undefined)).toBe(false);
    expect(isCompletedStatus(CUSTOM, "")).toBe(false);
  });
});

describe("isRequiredStatusOption", () => {
  it("protects todo, in progress and completed but not review or custom stages", () => {
    expect(CUSTOM.map(isRequiredStatusOption)).toEqual([true, true, false, true]);
    expect(isRequiredStatusOption(option("status_blocked"))).toBe(false);
  });
});

describe("statusOptionsOf", () => {
  it("reads the status field options", () => {
    expect(statusOptionsOf([statusField(CUSTOM)])).toBe(CUSTOM);
  });

  it("falls back to the defaults when the status field is missing", () => {
    expect(statusOptionsOf(undefined)).toBe(DEFAULT_STATUS_OPTIONS);
    expect(statusOptionsOf([])).toBe(DEFAULT_STATUS_OPTIONS);
  });
});
