import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { combineReducers, configureStore } from "@reduxjs/toolkit";
import type { Store } from "@reduxjs/toolkit";
import { create } from "@bufbuild/protobuf";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { MyOrganizationSchema } from "@uniffy/proto/organizations/v1/organizations_pb";
import { IDBFactory } from "fake-indexeddb";
import * as Y from "yjs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RootState } from "@/app/store";
import { setStoreRef } from "@/app/storeRef";
import { getAccessToken, setMemoryAccessToken } from "@/config/api";
import {
  pendingOrganizationNames,
  usePendingOrganizations,
  useSignOut,
  type PendingOrganization,
  type SignOutOptions,
} from "@/features/auth/hooks/useSignOut";
import { authReducer, setCredentials } from "@/features/auth/store/authSlice";
import {
  organizationsLoaded,
  organizationsReducer,
  summarizeOrganization,
} from "@/features/auth/store/organizationsSlice";
import { uploadService } from "@/features/files/upload";
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

type ListPending = () => Promise<PendingOrganization[]>;

function createAuthStore() {
  return configureStore({
    reducer: combineReducers({ auth: authReducer, organizations: organizationsReducer }),
  });
}

interface AccountMenuHooks {
  signOut: SignOut;
  listPending: ListPending;
}

function AccountMenu({ expose }: { expose: (hooks: AccountMenuHooks) => void }) {
  expose({ signOut: useSignOut(), listPending: usePendingOrganizations() });
  return null;
}

/** The hooks as a mounted account menu receives them. */
function mountAccountMenu(): AccountMenuHooks {
  let mounted: AccountMenuHooks | undefined;
  const menu = createElement(AccountMenu, { expose: (hooks) => (mounted = hooks) });
  const router = createElement(MemoryRouter, null, menu);
  renderToStaticMarkup(createElement(Provider, { store, children: router }));
  if (!mounted) throw new Error("account menu was not mounted");
  return mounted;
}

function mountSignOut(): SignOut {
  return mountAccountMenu().signOut;
}

function membership(id: string, name: string) {
  return summarizeOrganization(
    create(MyOrganizationSchema, {
      organization: { id, name, slug: name.toLowerCase() },
      role: OrganizationRole.MEMBER,
    }),
  );
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
  return storeRawRow(["NOTE", "newer", "G", "pending:1"], {}, 5);
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
    const purgeUser = vi.spyOn(uploadService, "purgeUser");
    const userKeys = [
      `uniffy:recent-items:org-1:${userId}`,
      `uniffy-files-view:filter:org-2:${userId}`,
    ];
    const otherUserKey = "uniffy-files-view:filter:org-2:someone-else";
    for (const key of [...userKeys, otherUserKey]) localStorage.setItem(key, "{}");
    expect(await mountSignOut()()).toBe(true);
    expect(isStorageEncryptionReady()).toBe(false);
    expect(store.getState().auth.user).toBeNull();
    expect(getAccessToken()).toBeNull();
    // Every stored upload row of the account goes, whichever tab or organization wrote it.
    expect(purgeUser).toHaveBeenCalledWith(userId);
    // So do the titles and filters it left in every organization; another account keeps its own.
    for (const key of userKeys) expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(otherUserKey)).toBe("{}");
  });

  it("names the organizations whose edits keep the user from signing out", async () => {
    store.dispatch(
      organizationsLoaded([membership("org-1", "Acme"), membership("org-2", "Globex")]),
    );
    await leaveStoredEdit("stored");
    const { signOut, listPending } = mountAccountMenu();
    expect(await signOut()).toBe(false);

    const pending = await listPending();
    expect(pending.map(({ id, organization }) => [id, organization?.name])).toEqual([
      ["org-1", "Acme"],
    ]);
    expect(pendingOrganizationNames(pending)).toBe("Acme");
  });

  it("names an organization the user left apart from the ones a switch can reach", () => {
    const acme = membership("org-1", "Acme");
    const globex = membership("org-2", "Globex");
    expect(
      pendingOrganizationNames([
        { id: "org-1", organization: acme },
        { id: "org-2", organization: globex },
        { id: "org-3", organization: null },
      ]),
    ).toBe("Acme, Globex, and an organization you no longer belong to");
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
