import type { Reducer } from "@reduxjs/toolkit";
import { endsOrganizationScope } from "@/features/auth/store/authActions";
import { QUICK_ACCESS_FILTERS } from "@/features/calendar/types/calendar";
import { instantDayKey } from "@/features/calendar/utils";
import { calendarUiReducer } from "@/features/calendar/store/calendarUiSlice";
import { chatUiReducer } from "@/features/chat/store/chatUiSlice";
import { resetFilesScope, type FilesState } from "@/features/files/store/filesSlice";
import { retainProjectsUi } from "@/features/projects/store/projectsUiPersist";
import type { ProjectsUiState } from "@/features/projects/types/ui";

type ChatUiState = ReturnType<typeof chatUiReducer>;
type CalendarUiState = ReturnType<typeof calendarUiReducer>;

/** Device preferences survive; auth and organizations handle logout in their own reducers. */
const SESSION_INDEPENDENT_SLICES = [
  "auth",
  "organizations",
  "theme",
  "zenMode",
  "editor",
  "callPreferences",
  "agentsUi",
  "recording",
] as const;

const SLICE_DEFAULTS = { type: "@@uniffy/slice-defaults" };

const CHAT_UI_LAYOUT_KEYS = [
  "sidebarOpen",
  "sidebarCollapsed",
  "density",
  "channelHeaderExpanded",
  "channelsSectionCollapsed",
  "dmSectionCollapsed",
  "archivedSectionCollapsed",
  "agentChatsSectionCollapsed",
  "splitActive",
] as const satisfies readonly (keyof ChatUiState)[];

const CALENDAR_UI_LAYOUT_KEYS = [
  "viewMode",
  "quickAccessFilter",
  "isSidebarCollapsed",
  "sidebarWidth",
  "collapsedSections",
] as const satisfies readonly (keyof CalendarUiState)[];

function pick<T extends object>(source: unknown, keys: readonly (keyof T)[]): Partial<T> {
  const record = (source ?? {}) as Record<keyof T, unknown>;
  return Object.fromEntries(
    keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]),
  ) as Partial<T>;
}

/**
 * Chat layout outlives a reload and a scope change. Replies, edits, jump targets, folder state and
 * open dialogs name one organization's channels and messages, so they start fresh.
 */
export function retainedChatUi(state: unknown): ChatUiState {
  return {
    ...chatUiReducer(undefined, SLICE_DEFAULTS),
    ...pick<ChatUiState>(state, CHAT_UI_LAYOUT_KEYS),
  };
}

/** Calendar layout outlives a reload and a scope change; it opens on today with no event or dialog open. */
export function retainedCalendarUi(state: unknown): CalendarUiState {
  const layout = pick<CalendarUiState>(state, CALENDAR_UI_LAYOUT_KEYS);
  return {
    ...calendarUiReducer(undefined, SLICE_DEFAULTS),
    ...layout,
    currentDate: instantDayKey(new Date()),
    // A filter stored under an older vocabulary matches every event and
    // highlights no pill, which reads as a broken calendar rather than a reset.
    quickAccessFilter:
      layout.quickAccessFilter && QUICK_ACCESS_FILTERS.includes(layout.quickAccessFilter)
        ? layout.quickAccessFilter
        : null,
  };
}

export function withSessionScope<
  S extends {
    projectsUi: ProjectsUiState;
    files?: FilesState;
    chatUi?: ChatUiState;
    calendarUi?: CalendarUiState;
  },
>(reducer: Reducer<S>): Reducer<S> {
  return (state, action) => {
    if (!state || !endsOrganizationScope(action)) {
      return reducer(state, action);
    }
    const kept: Partial<S> = { projectsUi: retainProjectsUi(state.projectsUi) } as Partial<S>;
    if (state.files) kept.files = resetFilesScope(state.files);
    if (state.chatUi) kept.chatUi = retainedChatUi(state.chatUi);
    if (state.calendarUi) kept.calendarUi = retainedCalendarUi(state.calendarUi);
    for (const key of SESSION_INDEPENDENT_SLICES) {
      if (key in state) {
        kept[key as keyof S] = state[key as keyof S];
      }
    }
    return reducer(kept as S, action);
  };
}
