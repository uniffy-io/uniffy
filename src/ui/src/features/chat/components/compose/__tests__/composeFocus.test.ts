import { describe, expect, it, vi } from "vitest";
import { restoreComposeFocus } from "@/features/chat/components/compose/composeFocus";

function composer() {
  const body = {};
  const sendButton = {};
  const document = { body, activeElement: body };
  const focus = vi.fn(() => {
    document.activeElement = editor;
  });
  const editor = { isConnected: true, ownerDocument: document, focus };
  const root = {
    isConnected: true,
    contains: (element: unknown) => element === editor || element === sendButton,
  };
  const restore = () =>
    restoreComposeFocus(root as unknown as HTMLElement, editor as unknown as HTMLElement);
  return { document, editor, root, sendButton, focus, restore };
}

describe("composer focus after sending", () => {
  it("returns focus to the editor after inert content blurs to the body", () => {
    const { document, editor, focus, restore } = composer();
    restore();
    expect(document.activeElement).toBe(editor);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("returns focus from the send button for a send that settles immediately", () => {
    const { document, editor, sendButton, restore } = composer();
    document.activeElement = sendButton;
    restore();
    expect(document.activeElement).toBe(editor);
  });

  it.each(["another composer", "a search field", "a dialog"])(
    "preserves focus moved to %s during the send",
    (name) => {
      const { document, focus, restore } = composer();
      const target = { name };
      document.activeElement = target;
      restore();
      expect(document.activeElement).toBe(target);
      expect(focus).not.toHaveBeenCalled();
    },
  );

  it("ignores a composer removed by navigation", () => {
    const { root, editor, focus, restore } = composer();
    root.isConnected = false;
    editor.isConnected = false;
    restore();
    expect(focus).not.toHaveBeenCalled();
  });

  it("ignores an editor moved outside the original composer", () => {
    const { root, focus, restore } = composer();
    root.contains = () => false;
    restore();
    expect(focus).not.toHaveBeenCalled();
  });

  it("tolerates refs cleared by unmount", () => {
    expect(() => restoreComposeFocus(null, null)).not.toThrow();
  });
});
