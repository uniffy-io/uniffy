import { describe, expect, it } from "vitest";
import { isEditableTarget, matchesShortcut } from "@/features/settings/hooks/useKeyboardShortcuts";

function key(value: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: value,
    code: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...extra,
  } as KeyboardEvent;
}

describe("keyboard shortcut matching", () => {
  it("recognizes Space for push to talk without matching modified Space", () => {
    expect(matchesShortcut(key(" ", { code: "Space" }), "Space")).toBe(true);
    expect(matchesShortcut(key(" ", { code: "Space", ctrlKey: true }), "Space")).toBe(false);
    expect(matchesShortcut(key(" "), "Ctrl+Alt+M")).toBe(false);
  });
  it("matches remapped call chords and rejects missing modifiers", () => {
    expect(matchesShortcut(key("m", { ctrlKey: true, altKey: true }), "Ctrl+Alt+M")).toBe(true);
    expect(matchesShortcut(key("m", { ctrlKey: true }), "Ctrl+Alt+M")).toBe(false);
    expect(matchesShortcut(key("f8"), "F8")).toBe(true);
  });
  it("protects editors and device selectors, including elements from another window", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(isEditableTarget({ tagName } as unknown as EventTarget)).toBe(true);
    }
    expect(
      isEditableTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget),
    ).toBe(true);
    expect(isEditableTarget(null)).toBe(false);
  });
});
