import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBlob } from "@/shared/utils/download";

describe("downloadBlob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clicks a named link and releases the URL only on the next frame", () => {
    const link = { href: "", download: "", click: vi.fn() };
    const appended: unknown[] = [];
    vi.stubGlobal("document", {
      createElement: vi.fn(() => link),
      body: {
        appendChild: (node: unknown) => appended.push(node),
        removeChild: (node: unknown) => appended.splice(appended.indexOf(node), 1),
      },
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:export"), revokeObjectURL });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });

    downloadBlob(new Blob(["a,b\r\n"]), "acme-rel-tasks-2026-10-01.csv");

    expect(link.click).toHaveBeenCalledOnce();
    expect(link.download).toBe("acme-rel-tasks-2026-10-01.csv");
    expect(link.href).toBe("blob:export");
    expect(appended).toEqual([]);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    frames.forEach((frame) => frame(0));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
  });
});
