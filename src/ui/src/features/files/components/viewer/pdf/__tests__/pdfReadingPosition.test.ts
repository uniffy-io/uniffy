import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getReadingPosition, setReadingPosition } from "../pdfReadingPosition";

const STORAGE_KEY = "uniffy.pdfReadingPositions";

interface MockStorage {
  store: Record<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  throwOnGet: boolean;
  throwOnSet: boolean;
}

function createMockStorage(): MockStorage {
  const storage: MockStorage = {
    store: {},
    throwOnGet: false,
    throwOnSet: false,
    getItem: (key) => {
      if (storage.throwOnGet) throw new Error("denied");
      return key in storage.store ? storage.store[key] : null;
    },
    setItem: (key, value) => {
      if (storage.throwOnSet) throw new Error("quota");
      storage.store[key] = String(value);
    },
  };
  return storage;
}

// Tests run in a node environment; the module reads window.localStorage at call
// time, so a minimal stub is enough.
function installMockWindow(storage: MockStorage): void {
  (globalThis as unknown as { window: { localStorage: MockStorage } }).window = {
    localStorage: storage,
  };
}

function uninstallMockWindow(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}

describe("pdfReadingPosition", () => {
  let storage: MockStorage;

  beforeEach(() => {
    storage = createMockStorage();
    installMockWindow(storage);
  });

  afterEach(() => {
    uninstallMockWindow();
  });

  it("round-trips a stored position", () => {
    setReadingPosition("file-a", 7);
    expect(getReadingPosition("file-a")).toBe(7);
  });

  it("returns null for unknown files", () => {
    expect(getReadingPosition("missing")).toBeNull();
  });

  it("deletes the entry when page 1 is written", () => {
    setReadingPosition("file-a", 7);
    setReadingPosition("file-a", 1);
    expect(getReadingPosition("file-a")).toBeNull();
    expect(storage.store[STORAGE_KEY]).not.toContain("file-a");
  });

  it("prunes to the 200 newest entries", () => {
    for (let index = 0; index < 201; index += 1) {
      setReadingPosition(`file-${index}`, 2, index);
    }
    expect(getReadingPosition("file-0")).toBeNull();
    expect(getReadingPosition("file-1")).toBe(2);
    expect(getReadingPosition("file-200")).toBe(2);
  });

  it("swallows storage write errors", () => {
    storage.throwOnSet = true;
    expect(() => setReadingPosition("file-a", 3)).not.toThrow();
  });

  it("swallows storage read errors", () => {
    storage.throwOnGet = true;
    expect(getReadingPosition("file-a")).toBeNull();
  });

  it("ignores corrupt stored JSON", () => {
    storage.store[STORAGE_KEY] = "not json";
    expect(getReadingPosition("file-a")).toBeNull();
    expect(() => setReadingPosition("file-a", 4)).not.toThrow();
    expect(getReadingPosition("file-a")).toBe(4);
  });
});
