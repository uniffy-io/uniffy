import { vi } from "vitest";

const nativeStorage = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  databases: new Map<string, import("node:sqlite").DatabaseSync>(),
  calls: { get: 0, set: 0, delete: 0, sql: 0, encrypt: 0, decrypt: 0 },
  failInsert: false,
  failDelete: false,
}));

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => {
    nativeStorage.calls.get++;
    return nativeStorage.secure.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    nativeStorage.calls.set++;
    nativeStorage.secure.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    nativeStorage.calls.delete++;
    nativeStorage.secure.delete(key);
  },
}));

vi.mock("expo-sqlite", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  return {
    openDatabaseAsync: async (name: string) => {
      const db = nativeStorage.databases.get(name) ?? new DatabaseSync(":memory:");
      nativeStorage.databases.set(name, db);
      const adapter = {
        execAsync: async (sql: string) => {
          nativeStorage.calls.sql++;
          db.exec(sql);
        },
        getFirstAsync: async (sql: string, ...params: import("node:sqlite").SQLInputValue[]) => {
          nativeStorage.calls.sql++;
          return db.prepare(sql).get(...params) ?? null;
        },
        getAllAsync: async (sql: string, ...params: import("node:sqlite").SQLInputValue[]) => {
          nativeStorage.calls.sql++;
          return db.prepare(sql).all(...params);
        },
        runAsync: async (sql: string, ...params: import("node:sqlite").SQLInputValue[]) => {
          nativeStorage.calls.sql++;
          if (
            (nativeStorage.failInsert && sql.startsWith("INSERT")) ||
            (nativeStorage.failDelete && sql.startsWith("DELETE"))
          )
            throw new Error("Disk failure");
          return db.prepare(sql).run(...params);
        },
        withExclusiveTransactionAsync: async (action: (tx: unknown) => Promise<void>) => {
          db.exec("BEGIN");
          try {
            await action(adapter);
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
        },
        closeAsync: async () => {},
      };
      return adapter;
    },
    deleteDatabaseAsync: async (name: string) => {
      nativeStorage.databases.get(name)?.close();
      nativeStorage.databases.delete(name);
    },
  };
});

vi.mock("expo-crypto", async () => {
  const { webcrypto } = await import("node:crypto");
  const bytes = (input: string | Uint8Array) =>
    typeof input === "string" ? Buffer.from(input, "base64") : input;
  class Key {
    constructor(readonly value: import("node:crypto").webcrypto.CryptoKey) {}
    static async generate() {
      return new Key(
        await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
          "encrypt",
          "decrypt",
        ]),
      );
    }
    static async import(value: string, encoding: "hex") {
      return new Key(
        await webcrypto.subtle.importKey("raw", Buffer.from(value, encoding), "AES-GCM", true, [
          "encrypt",
          "decrypt",
        ]),
      );
    }
    async encoded(encoding: "hex") {
      return Buffer.from(await webcrypto.subtle.exportKey("raw", this.value)).toString(encoding);
    }
  }
  return {
    AESEncryptionKey: Key,
    AESSealedData: { fromCombined: (input: Uint8Array) => input },
    aesEncryptAsync: async (
      input: Uint8Array,
      key: Key,
      options: { additionalData: Uint8Array },
    ) => {
      nativeStorage.calls.encrypt++;
      const iv = webcrypto.getRandomValues(new Uint8Array(12));
      const encrypted = await webcrypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: options.additionalData },
        key.value,
        bytes(input),
      );
      return { combined: async () => new Uint8Array([...iv, ...new Uint8Array(encrypted)]) };
    },
    aesDecryptAsync: async (
      input: Uint8Array,
      key: Key,
      options: { additionalData: Uint8Array },
    ) => {
      nativeStorage.calls.decrypt++;
      const plain = await webcrypto.subtle.decrypt(
        { name: "AES-GCM", iv: input.slice(0, 12), additionalData: options.additionalData },
        key.value,
        input.slice(12),
      );
      return Buffer.from(plain).toString("base64");
    },
  };
});

export { nativeStorage };
