import { describe, expect, it } from "vitest";
import { isNoteLoading } from "@/features/notes/utils/noteLoading";

describe("isNoteLoading", () => {
  it("is false with no note selected and nothing loading", () => {
    expect(isNoteLoading(null, null)).toBe(false);
    expect(isNoteLoading(null, undefined)).toBe(false);
  });

  it("is true only for the note being fetched", () => {
    expect(isNoteLoading("note-a", "note-a")).toBe(true);
    expect(isNoteLoading("note-a", "note-b")).toBe(false);
    expect(isNoteLoading(null, "note-a")).toBe(false);
  });
});
