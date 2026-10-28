/** The tab identity and the account and organization this tab's upload rows are stamped with. */

import type { UploadScope } from "@/features/files/upload/uploadTypes";

const TAB_ID_KEY = "uniffy:uploads:tab";

export function generateUploadId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// sessionStorage outlives a reload of the same tab, so the tab still recognizes its own records.
function readTabId(): string {
  try {
    const stored = sessionStorage.getItem(TAB_ID_KEY);
    if (stored) return stored;
    const id = generateUploadId();
    sessionStorage.setItem(TAB_ID_KEY, id);
    return id;
  } catch {
    return generateUploadId();
  }
}

const tabId = readTabId();
let tabScope: UploadScope | null = null;

export function uploadTabId(): string {
  return tabId;
}

export function getUploadScope(): UploadScope | null {
  return tabScope;
}

export function setUploadScope(scope: UploadScope | null): void {
  tabScope = scope;
}

export function sameUploadScope(
  owner: { userId?: string; organizationId?: string },
  scope: UploadScope,
): boolean {
  return (
    Boolean(owner.userId) &&
    owner.userId === scope.userId &&
    owner.organizationId === scope.organizationId
  );
}
