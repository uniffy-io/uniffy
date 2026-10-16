import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import type { Store } from "@reduxjs/toolkit";
import { IDBFactory } from "fake-indexeddb";
import * as Y from "yjs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RootState } from "@/app/store";
import { setStoreRef } from "@/app/storeRef";
import { getAccessToken, setMemoryAccessToken } from "@/config/api";
import { useSignOut, type SignOutOptions } from "@/features/auth/hooks/useSignOut";
import { authReducer, setCredentials } from "@/features/auth/store/authSlice";
import { clearPendingDocsFor } from "@/features/realtime";
import { listPendingDocs } from "@/features/realtime/pendingDocs";
import {
  closeSockets,
  installBrowser,
  openEditor,
  signInDevice,
  storeRawRow,
  type Editor,
} from "@/features/realtime/persistence/__tests__/browser";
import { attachEncryptedPersistence } from "@/features/realtime/persistence/encryptedYjsPersistence";
import { isStorageEncryptionReady } from "@/shared/crypto/storageEncryption";

type SignOut = (options?: SignOutOptions) => Promise<boolean>;

const open: Editor[] = [];
let accounts = 0;
let userId = "";
let store = createAuthStore();

function createAuthStore() {
  return configureStore({ reducer: { auth: authReducer } });
}

function AccountMenu({ expose }: { expose: (signOut: SignOut) => void }) {
  expose(useSignOut());
  return null;
}

/** The sign-out action as a mounted account menu receives it. */
function mountSignOut(): SignOut {
  let mounted: SignOut | undefined;
  const menu = createElement(AccountMenu, { expose: (signOut) => (mounted = signOut) });
  const router = createElement(MemoryRouter, null, menu);
  renderToStaticMarkup(createElement(Provider, { store, children: router }));
  if (!mounted) throw new Error("sign-out was not mounted");
  return mounted;
}

function signedIn(): boolean {
  return store.getState().auth.user !== null && isStorageEncryptionReady();
}

/** A document this account edited and closed before any checkpoint, with the drain registry lost. */
async function leaveStoredEdit(contentId: string): Promise<void> {
  const ydoc = new Y.Doc();
  ydoc.getMap("doc_meta").set("generation", "G");
  const persistence = attachEncryptedPersistence({
    contentType: "NOTE",
    contentId,
    ydoc,
    scope: {
      contentType: "NOTE",
      contentId,
      organizationId: "org-1",
      userId,
      discardOnClean: false,
    },
  });
  ydoc.transact(() => ydoc.getText("markdown").insert(0, "closed before saving"), "session");
  await persistence.destroy();
  ydoc.destroy();
  clearPendingDocsFor(userId);
}

/** A device database a newer app version left behind; this version cannot open it. */
function leaveNewerDatabase(): Promise<void> {
  return storeRawRow(["NOTE", "newer", "G", "pending:1"], {}, 4);
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("uniffy-realtime-yjs");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

beforeAll(() => installBrowser());

beforeEach(async () => {
  // A fresh browser profile per case: a signed-out tab still holds other caches open, and those
  // would block the next account's device wipe.
  vi.stubGlobal("indexedDB", new IDBFactory());
  // Navigation needs a mounted router; a static render only warns that it skipped it.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  userId = `account-${++accounts}`;
  await signInDevice(userId);
  store = createAuthStore();
  store.dispatch(
    setCredentials({
      user: { id: userId } as Parameters<typeof setCredentials>[0]["user"],
      accessToken: "access",
      refreshToken: "",
      organizationId: "org-1",
    }),
  );
  setStoreRef(store as unknown as Store<RootState>);
  setMemoryAccessToken("access");
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((editor) => editor.close()));
  closeSockets();
  vi.restoreAllMocks();
});

describe("sign-out draft guard", () => {
  it("keeps the device key while an open document holds an edit no checkpoint covers", async () => {
    const editor = openEditor("live");
    open.push(editor);
    editor.type("typed, never saved");
    expect(await mountSignOut()()).toBe(false);
    expect(signedIn()).toBe(true);
    expect(getAccessToken()).toBe("access");
  });

  it("keeps the device key for edits only this device still stores", async () => {
    await leaveStoredEdit("stored");
    expect(await mountSignOut()()).toBe(false);
    expect(signedIn()).toBe(true);
    expect(listPendingDocs().filter((entry) => entry.userId === userId)).toHaveLength(1);
  });

  it("keeps the device key while device storage cannot be read, and signs out once it can", async () => {
    await leaveNewerDatabase();
    const signOut = mountSignOut();
    expect(await signOut()).toBe(false);
    expect(signedIn()).toBe(true);
    await deleteDatabase();
    expect(await signOut()).toBe(true);
    expect(signedIn()).toBe(false);
  });

  it("rechecks edits made while device storage is scanned", async () => {
    const editor = openEditor("typing");
    open.push(editor);
    const signingOut = mountSignOut()();
    editor.type("typed during the scan");
    expect(await signingOut).toBe(false);
    expect(signedIn()).toBe(true);
  });

  it("signs out and drops the device key after a clean scan", async () => {
    expect(await mountSignOut()()).toBe(true);
    expect(isStorageEncryptionReady()).toBe(false);
    expect(store.getState().auth.user).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it("signs out without scanning when the user confirmed discarding unsaved edits", async () => {
    const editor = openEditor("discarded");
    open.push(editor);
    editor.type("discarded on purpose");
    await leaveNewerDatabase();
    expect(await mountSignOut()({ discardUnsynced: true })).toBe(true);
    expect(isStorageEncryptionReady()).toBe(false);
    expect(store.getState().auth.user).toBeNull();
  });
});
