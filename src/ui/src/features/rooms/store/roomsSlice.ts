import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type { Room, RoomType, RoomStatus, RoomBooking, TimeSlot } from "@/features/rooms/types";
import {
  fetchRooms,
  fetchRoom,
  initializeRoomsData,
  createRoom as createRoomThunk,
  updateRoom as updateRoomThunk,
  deleteRoom as deleteRoomThunk,
  createBooking as createBookingThunk,
  cancelBooking as cancelBookingThunk,
  fetchBookings,
  checkAvailability,
  findAvailableRooms,
  fetchAvailableRoomIds,
  openRoomViewer,
} from "@/features/rooms/store/roomsThunks";

/** Read-only room view opened from a mention chip, a search hit or /rooms/:roomId. */
interface RoomViewerState {
  roomId: string | null;
  /** The room page renders this state in place, so the global modal skips it. */
  inline: boolean;
  loading: boolean;
  error: string | null;
  bookings: RoomBooking[];
}

interface RoomsState {
  rooms: Record<string, Room>;
  roomIds: string[];
  bookings: Record<string, RoomBooking>;
  bookingIds: string[];
  availability: Record<string, TimeSlot[]>;
  availableRoomIds: string[] | null;
  selectedRoomId: string | null;
  viewer: RoomViewerState;
  filters: {
    roomType: RoomType | null;
    status: RoomStatus | null;
    minCapacity: number | null;
    amenities: string[];
    building: string;
    floor: string;
    searchQuery: string;
  };
  loading: {
    rooms: boolean;
    bookings: boolean;
    availability: boolean;
    availableRooms: boolean;
    creating: boolean;
    updating: boolean;
    deleting: boolean;
  };
  errors: {
    rooms: string | null;
    bookings: string | null;
    availability: string | null;
    creating: string | null;
    updating: string | null;
    deleting: string | null;
  };
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}

const initialState: RoomsState = {
  rooms: {},
  roomIds: [],
  bookings: {},
  bookingIds: [],
  availability: {},
  availableRoomIds: null,
  selectedRoomId: null,
  viewer: {
    roomId: null,
    inline: false,
    loading: false,
    error: null,
    bookings: [],
  },
  filters: {
    roomType: null,
    status: null,
    minCapacity: null,
    amenities: [],
    building: "",
    floor: "",
    searchQuery: "",
  },
  loading: {
    rooms: false,
    bookings: false,
    availability: false,
    availableRooms: false,
    creating: false,
    updating: false,
    deleting: false,
  },
  errors: {
    rooms: null,
    bookings: null,
    availability: null,
    creating: null,
    updating: null,
    deleting: null,
  },
  pagination: {
    page: 1,
    pageSize: 20,
    totalCount: 0,
    totalPages: 0,
  },
};

const roomsSlice = createSlice({
  name: "rooms",
  initialState,
  reducers: {
    selectRoom: (state, action: PayloadAction<string | null>) => {
      state.selectedRoomId = action.payload;
    },

    setFilters: (state, action: PayloadAction<Partial<RoomsState["filters"]>>) => {
      state.filters = { ...state.filters, ...action.payload };
    },

    clearFilters: (state) => {
      state.filters = initialState.filters;
    },

    clearAvailableRoomIds: (state) => {
      state.availableRoomIds = null;
      state.loading.availableRooms = false;
    },

    closeRoomViewer: (state) => {
      state.viewer = initialState.viewer;
    },

    clearRooms: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(initializeRoomsData.pending, (state) => {
        state.loading.rooms = true;
        state.errors.rooms = null;
      })
      .addCase(initializeRoomsData.fulfilled, (state, action) => {
        state.loading.rooms = false;
        const newRooms: Record<string, Room> = {};
        action.payload.rooms.forEach((room) => {
          newRooms[room.id] = room;
        });
        state.rooms = newRooms;
        state.roomIds = action.payload.rooms.map((r) => r.id);
        state.pagination.totalCount = action.payload.totalCount;
      })
      .addCase(initializeRoomsData.rejected, (state, action) => {
        state.loading.rooms = false;
        state.errors.rooms = action.payload || "Failed to load rooms";
      });

    builder
      .addCase(fetchRooms.pending, (state) => {
        state.loading.rooms = true;
        state.errors.rooms = null;
      })
      .addCase(fetchRooms.fulfilled, (state, action) => {
        state.loading.rooms = false;
        const newRooms: Record<string, Room> = {};
        action.payload.rooms.forEach((room) => {
          newRooms[room.id] = room;
        });
        state.rooms = newRooms;
        state.roomIds = action.payload.rooms.map((r) => r.id);
        state.pagination = {
          page: action.payload.page,
          pageSize: action.payload.pageSize,
          totalCount: action.payload.totalCount,
          totalPages: action.payload.totalPages,
        };
      })
      .addCase(fetchRooms.rejected, (state, action) => {
        state.loading.rooms = false;
        state.errors.rooms = action.payload || "Failed to fetch rooms";
      });

    builder.addCase(fetchRoom.fulfilled, (state, action) => {
      state.rooms[action.payload.id] = action.payload;
      if (!state.roomIds.includes(action.payload.id)) {
        state.roomIds.push(action.payload.id);
      }
    });

    builder
      .addCase(createRoomThunk.pending, (state) => {
        state.loading.creating = true;
        state.errors.creating = null;
      })
      .addCase(createRoomThunk.fulfilled, (state, action) => {
        state.loading.creating = false;
        state.rooms[action.payload.id] = action.payload;
        if (!state.roomIds.includes(action.payload.id)) {
          state.roomIds.push(action.payload.id);
        }
      })
      .addCase(createRoomThunk.rejected, (state, action) => {
        state.loading.creating = false;
        state.errors.creating = action.payload || "Failed to create room";
      });

    builder
      .addCase(updateRoomThunk.pending, (state) => {
        state.loading.updating = true;
        state.errors.updating = null;
      })
      .addCase(updateRoomThunk.fulfilled, (state, action) => {
        state.loading.updating = false;
        if (state.rooms[action.payload.id]) {
          state.rooms[action.payload.id] = action.payload;
        }
      })
      .addCase(updateRoomThunk.rejected, (state, action) => {
        state.loading.updating = false;
        state.errors.updating = action.payload || "Failed to update room";
      });

    builder
      .addCase(deleteRoomThunk.pending, (state) => {
        state.loading.deleting = true;
        state.errors.deleting = null;
      })
      .addCase(deleteRoomThunk.fulfilled, (state, action) => {
        state.loading.deleting = false;
        delete state.rooms[action.payload.roomId];
        state.roomIds = state.roomIds.filter((id) => id !== action.payload.roomId);
        if (state.selectedRoomId === action.payload.roomId) {
          state.selectedRoomId = null;
        }
      })
      .addCase(deleteRoomThunk.rejected, (state, action) => {
        state.loading.deleting = false;
        state.errors.deleting = action.payload || "Failed to delete room";
      });

    builder
      .addCase(createBookingThunk.pending, (state) => {
        state.loading.creating = true;
        state.errors.creating = null;
      })
      .addCase(createBookingThunk.fulfilled, (state, action) => {
        state.loading.creating = false;
        state.bookings[action.payload.id] = action.payload;
        if (!state.bookingIds.includes(action.payload.id)) {
          state.bookingIds.push(action.payload.id);
        }
      })
      .addCase(createBookingThunk.rejected, (state, action) => {
        state.loading.creating = false;
        state.errors.creating = action.payload || "Failed to create booking";
      });

    builder.addCase(cancelBookingThunk.fulfilled, (state, action) => {
      if (state.bookings[action.payload.id]) {
        state.bookings[action.payload.id] = action.payload;
      }
    });

    builder
      .addCase(fetchBookings.pending, (state) => {
        state.loading.bookings = true;
        state.errors.bookings = null;
      })
      .addCase(fetchBookings.fulfilled, (state, action) => {
        state.loading.bookings = false;
        const newBookings: Record<string, RoomBooking> = {};
        action.payload.bookings.forEach((booking) => {
          newBookings[booking.id] = booking;
        });
        state.bookings = newBookings;
        state.bookingIds = action.payload.bookings.map((b) => b.id);
      })
      .addCase(fetchBookings.rejected, (state, action) => {
        state.loading.bookings = false;
        state.errors.bookings = action.payload || "Failed to fetch bookings";
      });

    builder
      .addCase(checkAvailability.pending, (state) => {
        state.loading.availability = true;
        state.errors.availability = null;
      })
      .addCase(checkAvailability.fulfilled, (state, action) => {
        state.loading.availability = false;
        state.availability[action.payload.roomId] = action.payload.slots;
      })
      .addCase(checkAvailability.rejected, (state, action) => {
        state.loading.availability = false;
        state.errors.availability = action.payload || "Failed to check availability";
      });

    builder
      .addCase(findAvailableRooms.pending, (state) => {
        state.loading.rooms = true;
        state.errors.rooms = null;
      })
      .addCase(findAvailableRooms.fulfilled, (state, action) => {
        state.loading.rooms = false;
        const newRooms: Record<string, Room> = {};
        action.payload.forEach((room) => {
          newRooms[room.id] = room;
        });
        state.rooms = newRooms;
        state.roomIds = action.payload.map((r) => r.id);
      })
      .addCase(findAvailableRooms.rejected, (state, action) => {
        state.loading.rooms = false;
        state.errors.rooms = action.payload || "Failed to find available rooms";
      });

    builder
      .addCase(openRoomViewer.pending, (state, action) => {
        state.viewer.roomId = action.meta.arg.roomId;
        state.viewer.inline = action.meta.arg.inline ?? false;
        state.viewer.loading = true;
        state.viewer.error = null;
        state.viewer.bookings = [];
      })
      .addCase(openRoomViewer.fulfilled, (state, action) => {
        // A later open wins: a stale response must not repaint the room the user is looking at.
        if (state.viewer.roomId !== action.payload.roomId) return;
        state.viewer.loading = false;
        state.viewer.bookings = action.payload.bookings;
        // Keyed lookup only - roomIds drives the admin table and stays list-owned.
        state.rooms[action.payload.room.id] = action.payload.room;
        state.availability[action.payload.roomId] = action.payload.slots;
      })
      .addCase(openRoomViewer.rejected, (state, action) => {
        if (state.viewer.roomId !== action.meta.arg.roomId) return;
        state.viewer.loading = false;
        state.viewer.error = action.payload || "Failed to load room";
      });

    builder
      .addCase(fetchAvailableRoomIds.pending, (state) => {
        state.loading.availableRooms = true;
      })
      .addCase(fetchAvailableRoomIds.fulfilled, (state, action) => {
        state.loading.availableRooms = false;
        state.availableRoomIds = action.payload;
      })
      .addCase(fetchAvailableRoomIds.rejected, (state) => {
        state.loading.availableRooms = false;
        state.availableRoomIds = null;
      });
  },
});

export const roomsActions = roomsSlice.actions;

export const {
  selectRoom,
  setFilters,
  clearFilters,
  clearAvailableRoomIds,
  closeRoomViewer,
  clearRooms,
} = roomsSlice.actions;

export const selectAllRooms = (state: RootState): Room[] =>
  state.rooms.roomIds.map((id) => state.rooms.rooms[id]).filter(Boolean);

export const selectRoomById = (state: RootState, roomId: string): Room | undefined =>
  state.rooms.rooms[roomId];

export const selectSelectedRoomId = (state: RootState): string | null => state.rooms.selectedRoomId;

export const selectRoomFilters = (state: RootState): RoomsState["filters"] => state.rooms.filters;

export const selectRoomsLoading = (state: RootState): RoomsState["loading"] => state.rooms.loading;

export const selectRoomsPagination = (state: RootState): RoomsState["pagination"] =>
  state.rooms.pagination;

export const selectRoomBookings = (state: RootState): RoomBooking[] =>
  state.rooms.bookingIds.map((id) => state.rooms.bookings[id]).filter(Boolean);

// A shared empty list keeps the selector's result stable for rooms with no loaded slots.
const EMPTY_SLOTS: readonly TimeSlot[] = Object.freeze([]);

export const selectRoomAvailability = (state: RootState, roomId: string): readonly TimeSlot[] =>
  state.rooms.availability[roomId] ?? EMPTY_SLOTS;

export const selectAvailableRoomIds = (state: RootState): string[] | null =>
  state.rooms.availableRoomIds;

export const selectRoomViewer = (state: RootState): RoomViewerState => state.rooms.viewer;

export const roomsReducer = roomsSlice.reducer;
