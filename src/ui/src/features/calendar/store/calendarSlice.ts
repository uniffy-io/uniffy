import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type {
  CalendarEvent,
  Category,
  EventTemplate,
  EventFilters,
  EventActivity,
} from '@/features/calendar/types';
import { DEFAULT_CATEGORIES } from '@/features/calendar/constants';
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
  createEventTemplate,
  updateEventTemplate,
  deleteEventTemplate,
  listEventTemplates,
  fetchEventActivities,
} from '@/features/calendar/store/calendarThunks';

interface CalendarState {
  events: Record<string, CalendarEvent>;
  visibleEventIds: string[];
  categories: Record<string, Category>;
  templates: Record<string, EventTemplate>;
  /** Activity log per event id, newest first. */
  activities: Record<string, EventActivity[]>;
  filters: EventFilters;
  loading: {
    events: boolean;
    eventDetail: boolean;
    categories: boolean;
    templates: boolean;
    creating: boolean;
    updating: boolean;
    deleting: boolean;
  };
  errors: {
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
      organizationId: '',
      createdAt: now,
      updatedAt: now,
    };
  });

  return result;
}

const initialState: CalendarState = {
  events: {},
  visibleEventIds: [],
  categories: createDefaultCategories(),
  templates: {},
  activities: {},
  filters: {
    calendarIds: [],
    categoryIds: [],
    tagIds: [],
    searchQuery: '',
    focusTimeOnly: false,
  },
  loading: {
    events: false,
    eventDetail: false,
    categories: false,
    templates: false,
    creating: false,
    updating: false,
    deleting: false,
  },
  errors: {
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
  name: 'calendar',
  initialState,
  reducers: {
    setEvents: (state, action: PayloadAction<CalendarEvent[]>) => {
      state.events = action.payload.reduce((acc, event) => {
        acc[event.id] = event;
        return acc;
      }, {} as Record<string, CalendarEvent>);
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
      state.visibleEventIds = state.visibleEventIds.filter(
        (id) => id !== action.payload
      );
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

    setPagination: (
      state,
      action: PayloadAction<Partial<CalendarState['pagination']>>
    ) => {
      state.pagination = { ...state.pagination, ...action.payload };
    },

    resetCalendarState: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchEventsInRange.pending, (state) => {
        state.loading.events = true;
        state.errors.events = null;
      })
      .addCase(fetchEventsInRange.fulfilled, (state, action) => {
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
        state.loading.events = false;
        state.errors.events = action.payload || 'Failed to fetch events';
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
        state.errors.creating = action.payload || 'Failed to create event';
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
        state.errors.updating = action.payload || 'Failed to update event';
      });

    builder
      .addCase(deleteEventThunk.pending, (state) => {
        state.loading.deleting = true;
        state.errors.deleting = null;
      })
      .addCase(deleteEventThunk.fulfilled, (state, action) => {
        state.loading.deleting = false;
        delete state.events[action.payload.eventId];
        state.visibleEventIds = state.visibleEventIds.filter(
          (id) => id !== action.payload.eventId
        );
      })
      .addCase(deleteEventThunk.rejected, (state, action) => {
        state.loading.deleting = false;
        state.errors.deleting = action.payload || 'Failed to delete event';
      });

    builder
      .addCase(fetchCategories.pending, (state) => {
        state.loading.categories = true;
        state.errors.categories = null;
      })
      .addCase(fetchCategories.fulfilled, (state, action) => {
        state.loading.categories = false;
        state.categories = action.payload.reduce((acc, cat) => {
          acc[cat.id] = cat;
          return acc;
        }, {} as Record<string, Category>);
      })
      .addCase(fetchCategories.rejected, (state, action) => {
        state.loading.categories = false;
        state.errors.categories = action.payload || 'Failed to fetch categories';
      });

    builder
      .addCase(createCategoryThunk.fulfilled, (state, action) => {
        state.categories[action.payload.id] = action.payload;
      });

    builder
      .addCase(updateCategoryThunk.fulfilled, (state, action) => {
        if (state.categories[action.payload.id]) {
          state.categories[action.payload.id] = action.payload;
        }
      });

    builder
      .addCase(deleteCategoryThunk.fulfilled, (state, action) => {
        delete state.categories[action.payload.categoryId];
      });

    builder
      .addCase(addAttendees.fulfilled, (state, action) => {
        if (state.events[action.payload.id]) {
          state.events[action.payload.id] = action.payload;
        }
      });

    builder
      .addCase(removeAttendees.fulfilled, (state, action) => {
        if (state.events[action.payload.id]) {
          state.events[action.payload.id] = action.payload;
        }
      });

    builder
      .addCase(updateAttendeeStatus.fulfilled, (state, action) => {
        const { eventId, userId, status } = action.payload;
        const event = state.events[eventId];
        if (event) {
          state.events[eventId] = {
            ...event,
            attendees: event.attendees.map((a) =>
              a.id === userId ? { ...a, status } : a
            ),
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
        state.templates = action.payload.reduce((acc, t) => {
          acc[t.id] = t;
          return acc;
        }, {} as Record<string, EventTemplate>);
      })
      .addCase(listEventTemplates.rejected, (state, action) => {
        state.loading.templates = false;
        state.errors.templates = action.payload || 'Failed to fetch templates';
      });

    builder
      .addCase(fetchEventActivities.fulfilled, (state, action) => {
        state.activities[action.payload.eventId] = action.payload.activities;
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
