import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setThemeMode } from "@/config/theme/themeSlice";
import {
  openEventModal,
  selectEvent,
  setViewMode,
} from "@/features/calendar/store/calendarUiSlice";
import {
  openCreateChannelModal,
  setDensity,
  setReplyToMessage,
  toggleChannelsSection,
} from "@/features/chat/store/chatUiSlice";

const ROOT_KEY = "persist:root";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

/** One browser tab: its own module graph and store over the shared localStorage. */
async function openTab() {
  vi.resetModules();
  const tab = await import("@/app/store");
  await new Promise<void>((resolve) => {
    if (tab.persistor.getState().bootstrapped) return resolve();
    const unsubscribe = tab.persistor.subscribe(() => {
      if (!tab.persistor.getState().bootstrapped) return;
      unsubscribe();
      resolve();
    });
  });
  await tab.persistor.flush();
  return tab;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("persists layout only and keeps one tab's slices when another tab writes", async () => {
  const tabA = await openTab();
  const tabB = await openTab();

  tabA.store.dispatch(setDensity("compact"));
  tabA.store.dispatch(toggleChannelsSection());
  tabA.store.dispatch(openCreateChannelModal("category-a"));
  tabA.store.dispatch(
    setReplyToMessage({
      id: "message-a",
      channelId: "channel-a",
      senderName: "Ada",
      contentPreview: "Org A reply",
    }),
  );
  tabA.store.dispatch(setViewMode("month"));
  tabA.store.dispatch(selectEvent("event-a"));
  tabA.store.dispatch(openEventModal({ mode: "create", prefill: { title: "Org A meeting" } }));
  await tabA.persistor.flush();

  tabB.store.dispatch(setThemeMode("dark"));
  await tabB.persistor.flush();

  const stored = localStorage.getItem(ROOT_KEY)!;
  expect(stored).not.toContain("Org A reply");
  expect(stored).not.toContain("Org A meeting");

  const fresh = await openTab();
  const state = fresh.store.getState();
  expect(state.theme.themeMode).toBe("dark");
  expect(state.chatUi).toMatchObject({
    density: "compact",
    channelsSectionCollapsed: true,
    replyToMessage: null,
    editingMessage: null,
    createChannelModalOpen: false,
    createChannelCategoryId: null,
  });
  expect(state.calendarUi).toMatchObject({
    viewMode: "month",
    selectedEventId: null,
    isEventModalOpen: false,
    eventModalPrefill: null,
  });
});

it("drops recording recents an older client persisted", async () => {
  localStorage.setItem(
    ROOT_KEY,
    JSON.stringify({
      recording: JSON.stringify({
        source: "window",
        recents: [{ fileId: "file-a", filename: "Org A demo.webm", finishedAt: 1 }],
      }),
      _persist: JSON.stringify({ version: 5, rehydrated: true }),
    }),
  );

  const tab = await openTab();

  expect(tab.store.getState().recording.source).toBe("window");
  expect(tab.store.getState().recording).not.toHaveProperty("recents");
  expect(localStorage.getItem(ROOT_KEY)).not.toContain("Org A demo");
});
