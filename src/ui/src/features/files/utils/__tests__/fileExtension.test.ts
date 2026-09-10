import { describe, expect, it } from "vitest";
import { fileExtension } from "@/features/files/utils/fileExtension";

describe("fileExtension", () => {
  it("returns the last dotted suffix", () => {
    expect(fileExtension("clip.mp4")).toBe(".mp4");
    expect(fileExtension("archive.tar.gz")).toBe(".gz");
    expect(fileExtension("Screen Recording 2026-09-10 12.55.56.mp4")).toBe(".mp4");
  });

  it("treats dotfiles, trailing dots, and bare names as extensionless", () => {
    expect(fileExtension("README")).toBe("");
    expect(fileExtension(".bashrc")).toBe("");
    expect(fileExtension("trailing.")).toBe("");
    expect(fileExtension("")).toBe("");
  });
});
