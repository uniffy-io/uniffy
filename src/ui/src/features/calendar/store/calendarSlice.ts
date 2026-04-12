/**
 * Calendar Redux slice for domain state
 * Manages events, categories, and templates
 */

import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type {
  CalendarEvent,
  Category,
  EventTemplate,
  EventFilters,
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
} from '@/features/calendar/store/calendarThunks';

/**
 * Calendar domain state
 */
interface CalendarState {
  // Events indexed by ID
  events: Record<string, CalendarEvent>;

  // Event IDs for the current view date range
  visibleEventIds: string[];

  // Categories indexed by ID
  categories: Record<string, Category>;

  // Templates indexed by ID
  templates: Record<string, EventTemplate>;

  // Active filters
  filters: EventFilters;

  // Loading states
  loading: {
    events: boolean;
    categories: boolean;
    templates: boolean;
    creating: boolean;
    updating: boolean;
    deleting: boolean;
  };

  // Error states
  errors: {
    events: string | null;
    categories: string | null;
    templates: string | null;
    creating: string | null;
    updating: string | null;
    deleting: string | null;
  };

  // Pagination
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    hasMore: boolean;
  };
}

/**
 * Convert default categories to proper Category type
 */
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
  filters: {
    calendarIds: [],
    categoryIds: [],
    tags: [],
    searchQuery: '',
    focusTimeOnly: false,
  },
  loading: {
    events: false,
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
    // Event actions
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

    // Category CRUD
    addCategory: (state, action: PayloadAction<Category>) => {
      state.categories[action.payload.id] = action.payload;
    },

    updateCategory: (state, action: PayloadAction<Category>) => {
      if (state.categories[action.payload.id]) {
        state.categories[action.payload.id] = action.payload;
      }
    },

    removeCategory: (state, action: PayloadAction<string>) => {
      delete state.categories[action.payload];
    },

    // Filters
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
      const tag = action.payload;
      const index = state.filters.tags.indexOf(tag);

      if (index === -1) {
        state.filters.tags.push(tag);
      } else {
        state.filters.tags.splice(index, 1);
      }
    },

    // Loading states
    setEventsLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.events = action.payload;
    },

    setCreatingLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.creating = action.payload;
    },

    setUpdatingLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.updating = action.payload;
    },

    setDeletingLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.deleting = action.payload;
    },

    // Error states
    setEventsError: (state, action: PayloadAction<string | null>) => {
      state.errors.events = action.payload;
    },

    setCreatingError: (state, action: PayloadAction<string | null>) => {
      state.errors.creating = action.payload;
    },

    clearErrors: (state) => {
      state.errors = initialState.errors;
    },

    // Pagination
    setPagination: (
      state,
      action: PayloadAction<Partial<CalendarState['pagination']>>
    ) => {
      state.pagination = { ...state.pagination, ...action.payload };
    },

    // Reset state
    resetCalendarState: () => initialState,
  },
  extraReducers: (builder) => {
    // Event Thunks

    // Fetch events in range
    builder
      .addCase(fetchEventsInRange.pending, (state) => {
        state.loading.events = true;
        state.errors.events = null;
      })
      .addCase(fetchEventsInRange.fulfilled, (state, action) => {
        state.loading.events = false;
        // Replace events entirely to clear stale/deleted entries
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

    // Fetch single event
    builder
      .addCase(fetchEvent.fulfilled, (state, action) => {
        state.events[action.payload.id] = action.payload;
        if (!state.visibleEventIds.includes(action.payload.id)) {
          state.visibleEventIds.push(action.payload.id);
        }
      });

    // Create event
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

    // Update event
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

    // Delete event
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

    // Category Thunks

    // Fetch categories
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

    // Create category
    builder
      .addCase(createCategoryThunk.fulfilled, (state, action) => {
        state.categories[action.payload.id] = action.payload;
      });

    // Update category
    builder
      .addCase(updateCategoryThunk.fulfilled, (state, action) => {
        if (state.categories[action.payload.id]) {
          state.categories[action.payload.id] = action.payload;
        }
      });

    // Delete category
    builder
      .addCase(deleteCategoryThunk.fulfilled, (state, action) => {
        delete state.categories[action.payload.categoryId];
      });

    // Attendee Thunks

    // Add attendees
    builder
      .addCase(addAttendees.fulfilled, (state, action) => {
        if (state.events[action.payload.id]) {
          state.events[action.payload.id] = action.payload;
        }
      });

    // Remove attendees
    builder
      .addCase(removeAttendees.fulfilled, (state, action) => {
        if (state.events[action.payload.id]) {
          state.events[action.payload.id] = action.payload;
        }
      });

    // Update attendee status (optimistic local update)
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

    // Templates
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
  },
});

export const {
  setEvents,
  addEvent,
  updateEvent,
  removeEvent,
  addCategory,
  updateCategory,
  removeCategory,
  setFilters,
  clearFilters,
  setSearchQuery,
  toggleCategoryFilter,
  toggleTagFilter,
  setEventsLoading,
  setCreatingLoading,
  setUpdatingLoading,
  setDeletingLoading,
  setEventsError,
  setCreatingError,
  clearErrors,
  setPagination,
  resetCalendarState,
} = calendarSlice.actions;

export const calendarReducer = calendarSlice.reducer;
