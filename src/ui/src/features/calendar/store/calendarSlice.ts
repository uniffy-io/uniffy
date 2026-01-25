/**
 * Calendar Redux slice for domain state
 * Manages events, calendars, categories, and templates
 */

import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type {
  CalendarEvent,
  Calendar,
  Category,
  EventFilters,
} from '../types';
import { DEFAULT_CATEGORIES, CALENDAR_COLORS } from '../constants';
import {
  fetchEventsInRange,
  fetchEvent,
  createEvent as createEventThunk,
  updateEvent as updateEventThunk,
  deleteEvent as deleteEventThunk,
  fetchCalendars,
  createCalendar as createCalendarThunk,
  updateCalendar as updateCalendarThunk,
  deleteCalendar as deleteCalendarThunk,
  fetchCategories,
  createCategory as createCategoryThunk,
  updateCategory as updateCategoryThunk,
  deleteCategory as deleteCategoryThunk,
  addAttendees,
  removeAttendees,
} from './calendarThunks';

/**
 * Calendar domain state
 */
interface CalendarState {
  // Events indexed by ID
  events: Record<string, CalendarEvent>;

  // Event IDs for the current view date range
  visibleEventIds: string[];

  // User's calendars indexed by ID
  calendars: Record<string, Calendar>;

  // Categories indexed by ID
  categories: Record<string, Category>;

  // Visible calendar IDs (checkboxes in sidebar)
  visibleCalendarIds: string[];

  // Active filters
  filters: EventFilters;

  // Loading states
  loading: {
    events: boolean;
    calendars: boolean;
    categories: boolean;
    creating: boolean;
    updating: boolean;
    deleting: boolean;
  };

  // Error states
  errors: {
    events: string | null;
    calendars: string | null;
    categories: string | null;
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
 * Default calendars for new users
 */
const defaultCalendars: Calendar[] = [
  {
    id: 'personal',
    name: 'Personal',
    color: CALENDAR_COLORS.personal,
    isVisible: true,
    isDefault: true,
    ownerId: '',
    organizationId: '',
    type: 'personal',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'work',
    name: 'Work',
    color: CALENDAR_COLORS.work,
    isVisible: true,
    isDefault: false,
    ownerId: '',
    organizationId: '',
    type: 'work',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

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
  calendars: defaultCalendars.reduce((acc, cal) => {
    acc[cal.id] = cal;
    return acc;
  }, {} as Record<string, Calendar>),
  categories: createDefaultCategories(),
  visibleCalendarIds: defaultCalendars.map((c) => c.id),
  filters: {
    calendarIds: [],
    categoryIds: [],
    tags: [],
    searchQuery: '',
    focusTimeOnly: false,
  },
  loading: {
    events: false,
    calendars: false,
    categories: false,
    creating: false,
    updating: false,
    deleting: false,
  },
  errors: {
    events: null,
    calendars: null,
    categories: null,
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

    // Calendar visibility
    toggleCalendarVisibility: (state, action: PayloadAction<string>) => {
      const calendarId = action.payload;
      const calendar = state.calendars[calendarId];

      if (calendar) {
        calendar.isVisible = !calendar.isVisible;

        if (calendar.isVisible) {
          if (!state.visibleCalendarIds.includes(calendarId)) {
            state.visibleCalendarIds.push(calendarId);
          }
        } else {
          state.visibleCalendarIds = state.visibleCalendarIds.filter(
            (id) => id !== calendarId
          );
        }
      }
    },

    setVisibleCalendars: (state, action: PayloadAction<string[]>) => {
      state.visibleCalendarIds = action.payload;
      Object.values(state.calendars).forEach((calendar) => {
        calendar.isVisible = action.payload.includes(calendar.id);
      });
    },

    // Calendar CRUD
    addCalendar: (state, action: PayloadAction<Calendar>) => {
      state.calendars[action.payload.id] = action.payload;
      if (action.payload.isVisible) {
        state.visibleCalendarIds.push(action.payload.id);
      }
    },

    updateCalendar: (state, action: PayloadAction<Calendar>) => {
      if (state.calendars[action.payload.id]) {
        state.calendars[action.payload.id] = action.payload;
      }
    },

    removeCalendar: (state, action: PayloadAction<string>) => {
      delete state.calendars[action.payload];
      state.visibleCalendarIds = state.visibleCalendarIds.filter(
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
    // ========================================================================
    // Event Thunks
    // ========================================================================

    // Fetch events in range
    builder
      .addCase(fetchEventsInRange.pending, (state) => {
        state.loading.events = true;
        state.errors.events = null;
      })
      .addCase(fetchEventsInRange.fulfilled, (state, action) => {
        state.loading.events = false;
        action.payload.forEach((event) => {
          state.events[event.id] = event;
        });
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

    // ========================================================================
    // Calendar Thunks
    // ========================================================================

    // Fetch calendars
    builder
      .addCase(fetchCalendars.pending, (state) => {
        state.loading.calendars = true;
        state.errors.calendars = null;
      })
      .addCase(fetchCalendars.fulfilled, (state, action) => {
        state.loading.calendars = false;
        state.calendars = action.payload.reduce((acc, cal) => {
          acc[cal.id] = cal;
          return acc;
        }, {} as Record<string, Calendar>);
        state.visibleCalendarIds = action.payload
          .filter((c) => c.isVisible)
          .map((c) => c.id);
      })
      .addCase(fetchCalendars.rejected, (state, action) => {
        state.loading.calendars = false;
        state.errors.calendars = action.payload || 'Failed to fetch calendars';
      });

    // Create calendar
    builder
      .addCase(createCalendarThunk.fulfilled, (state, action) => {
        state.calendars[action.payload.id] = action.payload;
        if (action.payload.isVisible) {
          state.visibleCalendarIds.push(action.payload.id);
        }
      });

    // Update calendar
    builder
      .addCase(updateCalendarThunk.fulfilled, (state, action) => {
        if (state.calendars[action.payload.id]) {
          state.calendars[action.payload.id] = action.payload;
          // Update visibility list
          if (action.payload.isVisible) {
            if (!state.visibleCalendarIds.includes(action.payload.id)) {
              state.visibleCalendarIds.push(action.payload.id);
            }
          } else {
            state.visibleCalendarIds = state.visibleCalendarIds.filter(
              (id) => id !== action.payload.id
            );
          }
        }
      });

    // Delete calendar
    builder
      .addCase(deleteCalendarThunk.fulfilled, (state, action) => {
        delete state.calendars[action.payload.calendarId];
        state.visibleCalendarIds = state.visibleCalendarIds.filter(
          (id) => id !== action.payload.calendarId
        );
      });

    // ========================================================================
    // Category Thunks
    // ========================================================================

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

    // ========================================================================
    // Attendee Thunks
    // ========================================================================

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
  },
});

export const {
  setEvents,
  addEvent,
  updateEvent,
  removeEvent,
  toggleCalendarVisibility,
  setVisibleCalendars,
  addCalendar,
  updateCalendar,
  removeCalendar,
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

export default calendarSlice.reducer;
