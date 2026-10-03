import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type {
  CalendarEvent,
  Category,
  EventTemplate,
  EventFilters,
  EventActivity,
} from "@/features/calendar/types";
import { DEFAULT_CATEGORIES } from "@/features/calendar/constants";
import {
  fetchEventsInRange,
  fetchEvent,
  createEvent as createEventThunk,
  updateEvent as updateEventThunk,
  deleteEvent as deleteEventThunk,
  fetchCategories,
  createCategory as createCategoryThunk,
  updateCategory as updateCategoryThunk,
  deleteCategory as deleteCategoryThunk,
  addAttendees,
  removeAttendees,
  updateAttendeeStatus,
  updateAttendeeRole,
  createEventTemplate,
  updateEventTemplate,
  deleteEventTemplate,
  listEventTemplates,
  fetchEventActivities,
  fetchFreeBusy,
  fetchMeetingSuggestions,
} from "@/features/calendar/store/calendarThunks";
import {
  createCalendar,
  deleteCalendar,
  fetchCalendarPolicy,
  fetchCalendars,
  setCalendarVisibility,
  updateCalendar,
  updateCalendarPolicy,
} from "@/features/calendar/store/calendarsThunks";
import type { FreeBusyData, MeetingSuggestion } from "@/features/calendar/types/scheduling";
import type { CalendarInfo, CalendarPolicyInfo } from "@/features/calendar/types";

interface CalendarState {
  /** The calendars the member can see, in the server's list order. */
  calendars: Record<string, CalendarInfo>;
  calendarOrder: string[];
  calendarPolicy: CalendarPolicyInfo | null;
  /** Latest visibility request per calendar; an older response must not undo a newer click. */
  pendingVisibility: Record<string, string>;
  events: Record<string, CalendarEvent>;
  /** Latest range request, so an older response cannot overwrite a newer grid. */
  eventsRequestId: string | null;
  visibleEventIds: string[];
  categories: Record<string, Category>;
  templates: Record<string, EventTemplate>;
  /** Activity log per event id, newest first. */
  activities: Record<string, EventActivity[]>;
  filters: EventFilters;
  scheduling: {
    /** Request key of the stored freeBusy data, so stale responses are ignorable. */
    freeBusyKey: string | null;
    freeBusy: FreeBusyData | null;
    suggestions: MeetingSuggestion[];
  };
  loading: {
    calendars: boolean;
    events: boolean;
    eventDetail: boolean;
    categories: boolean;
    templates: boolean;
    creating: boolean;
    updating: boolean;
    deleting: boolean;
    freeBusy: boolean;
    suggestions: boolean;
  };
  errors: {
    calendars: string | null;
    events: string | null;
    categories: string | null;
    templates: string | null;
    creating: string | null;
    updating: string | null;
    deleting: string | null;
  };
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    hasMore: boolean;
  };
}

function createDefaultCategories(): Record<string, Category> {
  const now = new Date().toISOString();
  const result: Record<string, Category> = {};

  DEFAULT_CATEGORIES.forEach((cat) => {
    result[cat.id] = {
      ...cat,
      organizationId: "",
      createdAt: now,
      updatedAt: now,
    };
  });

  return result;
}

const initialState: CalendarState = {
  calendars: {},
  calendarOrder: [],
  pendingVisibility: {},
  eventsRequestId: null,
  calendarPolicy: null,
  events: {},
  visibleEventIds: [],
  categories: createDefaultCategories(),
  templates: {},
  activities: {},
  filters: {
    calendarIds: [],
    categoryIds: [],
    tagIds: [],
    searchQuery: "",
    focusTimeOnly: false,
  },
  scheduling: {
    freeBusyKey: null,
    freeBusy: null,
    suggestions: [],
  },
  loading: {
    calendars: false,
    events: false,
    eventDetail: false,
    categories: false,
    templates: false,
    creating: false,
    updating: false,
    deleting: false,
    freeBusy: false,
    suggestions: false,
  },
  errors: {
    calendars: null,
    events: null,
    categories: null,
    templates: null,
    creating: null,
    updating: null,
    deleting: null,
  },
  pagination: {
    page: 1,
    pageSize: 100,
    totalCount: 0,
    hasMore: false,
  },
};

const calendarSlice = createSlice({
  name: "calendar",
  initialState,
  reducers: {
    setEvents: (state, action: PayloadAction<CalendarEvent[]>) => {
      state.events = action.payload.reduce(
        (acc, event) => {
          acc[event.id] = event;
          return acc;
        },
        {} as Record<string, CalendarEvent>,
      );
      state.visibleEventIds = action.payload.map((e) => e.id);
    },

    addEvent: (state, action: PayloadAction<CalendarEvent>) => {
      state.events[action.payload.id] = action.payload;
      if (!state.visibleEventIds.includes(action.payload.id)) {
        state.visibleEventIds.push(action.payload.id);
      }
    },

    updateEvent: (state, action: PayloadAction<CalendarEvent>) => {
      if (state.events[action.payload.id]) {
        state.events[action.payload.id] = action.payload;
      }
    },

    removeEvent: (state, action: PayloadAction<string>) => {
      delete state.events[action.payload];
      state.visibleEventIds = state.visibleEventIds.filter((id) => id !== action.payload);
    },

    updateCategory: (state, action: PayloadAction<Category>) => {
      if (state.categories[action.payload.id]) {
        state.categories[action.payload.id] = action.payload;
      }
    },

    setFilters: (state, action: PayloadAction<Partial<EventFilters>>) => {
      state.filters = { ...state.filters, ...action.payload };
    },

    clearFilters: (state) => {
      state.filters = initialState.filters;
    },

    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.filters.searchQuery = action.payload;
    },

    toggleCategoryFilter: (state, action: PayloadAction<string>) => {
      const categoryId = action.payload;
      const index = state.filters.categoryIds.indexOf(categoryId);

      if (index === -1) {
        state.filters.categoryIds.push(categoryId);
      } else {
        state.filters.categoryIds.splice(index, 1);
      }
    },

    toggleTagFilter: (state, action: PayloadAction<string>) => {
      const tagId = action.payload;
      const index = state.filters.tagIds.indexOf(tagId);

      if (index === -1) {
        state.filters.tagIds.push(tagId);
      } else {
        state.filters.tagIds.splice(index, 1);
      }
    },

    clearErrors: (state) => {
      state.errors = initialState.errors;
    },

    setPagination: (state, action: PayloadAction<Partial<CalendarState["pagination"]>>) => {
      state.pagination = { ...state.pagination, ...action.payload };
    },

    resetCalendarState: () => initialState,
  },
  extraReducers: (builder) => {
    const storeCalendar = (state: CalendarState, calendar: CalendarInfo) => {
      state.calendars[calendar.id] = calendar;
      if (!state.calendarOrder.includes(calendar.id)) state.calendarOrder.push(calendar.id);
    };

    builder
      .addCase(fetchCalendars.pending, (state) => {
        state.loading.calendars = true;
        state.errors.calendars = null;
      })
      .addCase(fetchCalendars.fulfilled, (state, action) => {
        state.loading.calendars = false;
        const previous = state.calendars;
        state.calendars = Object.fromEntries(
          action.payload.map((c) => [
            c.id,
            // A toggle still in flight wins over the list it raced with.
            state.pendingVisibility[c.id] && previous[c.id]
              ? { ...c, isHidden: previous[c.id].isHidden }
              : c,
          ]),
        );
        state.calendarOrder = action.payload.map((c) => c.id);
      })
      .addCase(fetchCalendars.rejected, (state, action) => {
        state.loading.calendars = false;
        state.errors.calendars = action.payload || "Failed to load calendars";
      })
      .addCase(createCalendar.fulfilled, (state, action) => storeCalendar(state, action.payload))
      .addCase(updateCalendar.fulfilled, (state, action) => storeCalendar(state, action.payload))
      .addCase(setCalendarVisibility.pending, (state, action) => {
        // Optimistic: the eye toggles at once and the events follow the refetch.
        const { calendarId, hidden } = action.meta.arg;
        state.pendingVisibility[calendarId] = action.meta.requestId;
        const calendar = state.calendars[calendarId];
        if (calendar) calendar.isHidden = hidden;
      })
      .addCase(setCalendarVisibility.fulfilled, (state, action) => {
        const { calendarId } = action.meta.arg;
        if (state.pendingVisibility[calendarId] !== action.meta.requestId) return;
        delete state.pendingVisibility[calendarId];
        storeCalendar(state, action.payload);
      })
      .addCase(setCalendarVisibility.rejected, (state, action) => {
        const { calendarId, hidden } = action.meta.arg;
        if (state.pendingVisibility[calendarId] !== action.meta.requestId) return;
        delete state.pendingVisibility[calendarId];
        const calendar = state.calendars[calendarId];
        if (calendar) calendar.isHidden = !hidden;
      })
      .addCase(deleteCalendar.fulfilled, (state, action) => {
        delete state.calendars[action.payload.calendarId];
        state.calendarOrder = state.calendarOrder.filter((id) => id !== action.payload.calendarId);
      })
      .addCase(fetchCalendarPolicy.fulfilled, (state, action) => {
        state.calendarPolicy = action.payload;
      })
      .addCase(updateCalendarPolicy.fulfilled, (state, action) => {
        state.calendarPolicy = action.payload;
      });

    builder
      .addCase(fetchEventsInRange.pending, (state, action) => {
        state.loading.events = true;
        state.errors.events = null;
        state.eventsRequestId = action.meta.requestId;
      })
      .addCase(fetchEventsInRange.fulfilled, (state, action) => {
        if (state.eventsRequestId !== action.meta.requestId) return;
        state.loading.events = false;
        // Replace map wholesale so deleted entries drop out.
        const newEvents: Record<string, CalendarEvent> = {};
        action.payload.forEach((event) => {
          newEvents[event.id] = event;
        });
        state.events = newEvents;
        state.visibleEventIds = action.payload.map((e) => e.id);
      })
      .addCase(fetchEventsInRange.rejected, (state, action) => {
        if (state.eventsRequestId !== action.meta.requestId) return;
        state.loading.events = false;
        state.errors.events = action.payload || "Failed to fetch events";
      });

    builder
      .addCase(fetchEvent.pending, (state) => {
        state.loading.eventDetail = true;
      })
      .addCase(fetchEvent.fulfilled, (state, action) => {
        state.loading.eventDetail = false;
        state.events[action.payload.id] = action.payload;
        if (!state.visibleEventIds.includes(action.payload.id)) {
          state.visibleEventIds.push(action.payload.id);
        }
      })
      .addCase(fetchEvent.rejected, (state) => {
        state.loading.eventDetail = false;
      });

    builder
      .addCase(createEventThunk.pending, (state) => {
        state.loading.creating = true;
        state.errors.creating = null;
      })
      .addCase(createEventThunk.fulfilled, (state, action) => {
        state.loading.creating = false;
        state.events[action.payload.id] = action.payload;
        if (!state.visibleEventIds.includes(action.payload.id)) {
          state.visibleEventIds.push(action.payload.id);
        }
      })
      .addCase(createEventThunk.rejected, (state, action) => {
        state.loading.creating = false;
        state.errors.creating = action.payload || "Failed to create event";
      });

    builder
      .addCase(updateEventThunk.pending, (state) => {
        state.loading.updating = true;
        state.errors.updating = null;
      })
      .addCase(updateEventThunk.fulfilled, (state, action) => {
        state.loading.updating = false;
        if (state.events[action.payload.id]) {
          state.events[action.payload.id] = action.payload;
        }
      })
      .addCase(updateEventThunk.rejected, (state, action) => {
        state.loading.updating = false;
        state.errors.updating = action.payload || "Failed to update event";
      });

    builder
      .addCase(deleteEventThunk.pending, (state) => {
        state.loading.deleting = true;
        state.errors.deleting = null;
      })
      .addCase(deleteEventThunk.fulfilled, (state, action) => {
        state.loading.deleting = false;
        delete state.events[action.payload.eventId];
        state.visibleEventIds = state.visibleEventIds.filter((id) => id !== action.payload.eventId);
      })
      .addCase(deleteEventThunk.rejected, (state, action) => {
        state.loading.deleting = false;
        state.errors.deleting = action.payload || "Failed to delete event";
      });

    builder
      .addCase(fetchCategories.pending, (state) => {
        state.loading.categories = true;
        state.errors.categories = null;
      })
      .addCase(fetchCategories.fulfilled, (state, action) => {
        state.loading.categories = false;
        state.categories = action.payload.reduce(
          (acc, cat) => {
            acc[cat.id] = cat;
            return acc;
          },
          {} as Record<string, Category>,
        );
      })
      .addCase(fetchCategories.rejected, (state, action) => {
        state.loading.categories = false;
        state.errors.categories = action.payload || "Failed to fetch categories";
      });

    builder.addCase(createCategoryThunk.fulfilled, (state, action) => {
      state.categories[action.payload.id] = action.payload;
    });

    builder.addCase(updateCategoryThunk.fulfilled, (state, action) => {
      if (state.categories[action.payload.id]) {
        state.categories[action.payload.id] = action.payload;
      }
    });

    builder.addCase(deleteCategoryThunk.fulfilled, (state, action) => {
      delete state.categories[action.payload.categoryId];
    });

    builder.addCase(addAttendees.fulfilled, (state, action) => {
      if (state.events[action.payload.id]) {
        state.events[action.payload.id] = action.payload;
      }
    });

    builder.addCase(removeAttendees.fulfilled, (state, action) => {
      if (state.events[action.payload.id]) {
        state.events[action.payload.id] = action.payload;
      }
    });

    builder.addCase(updateAttendeeStatus.fulfilled, (state, action) => {
      const { eventId, userId, status } = action.payload;
      const event = state.events[eventId];
      if (event) {
        state.events[eventId] = {
          ...event,
          attendees: event.attendees.map((a) => (a.id === userId ? { ...a, status } : a)),
        };
      }
    });

    builder.addCase(updateAttendeeRole.fulfilled, (state, action) => {
      const { eventId, userId, role } = action.payload;
      const event = state.events[eventId];
      if (event) {
        state.events[eventId] = {
          ...event,
          attendees: event.attendees.map((a) => (a.id === userId ? { ...a, role } : a)),
        };
      }
    });

    builder
      .addCase(createEventTemplate.fulfilled, (state, action) => {
        state.templates[action.payload.id] = action.payload;
      })
      .addCase(updateEventTemplate.fulfilled, (state, action) => {
        state.templates[action.payload.id] = action.payload;
      })
      .addCase(deleteEventTemplate.fulfilled, (state, action) => {
        delete state.templates[action.payload];
      })
      .addCase(listEventTemplates.pending, (state) => {
        state.loading.templates = true;
        state.errors.templates = null;
      })
      .addCase(listEventTemplates.fulfilled, (state, action) => {
        state.loading.templates = false;
        state.templates = action.payload.reduce(
          (acc, t) => {
            acc[t.id] = t;
            return acc;
          },
          {} as Record<string, EventTemplate>,
        );
      })
      .addCase(listEventTemplates.rejected, (state, action) => {
        state.loading.templates = false;
        state.errors.templates = action.payload || "Failed to fetch templates";
      });

    builder.addCase(fetchEventActivities.fulfilled, (state, action) => {
      state.activities[action.payload.eventId] = action.payload.activities;
    });

    builder
      .addCase(fetchFreeBusy.pending, (state) => {
        state.loading.freeBusy = true;
      })
      .addCase(fetchFreeBusy.fulfilled, (state, action) => {
        state.loading.freeBusy = false;
        state.scheduling.freeBusyKey = action.payload.key;
        state.scheduling.freeBusy = action.payload.data;
      })
      .addCase(fetchFreeBusy.rejected, (state) => {
        state.loading.freeBusy = false;
      })
      .addCase(fetchMeetingSuggestions.pending, (state) => {
        state.loading.suggestions = true;
      })
      .addCase(fetchMeetingSuggestions.fulfilled, (state, action) => {
        state.loading.suggestions = false;
        state.scheduling.suggestions = action.payload;
      })
      .addCase(fetchMeetingSuggestions.rejected, (state) => {
        state.loading.suggestions = false;
        state.scheduling.suggestions = [];
      });
  },
});

export const {
  setEvents,
  addEvent,
  updateEvent,
  removeEvent,
  updateCategory,
  setFilters,
  clearFilters,
  setSearchQuery,
  toggleCategoryFilter,
  toggleTagFilter,
  clearErrors,
  setPagination,
  resetCalendarState,
} = calendarSlice.actions;

export const calendarReducer = calendarSlice.reducer;
