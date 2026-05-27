import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Plus,
  MagnifyingGlass,
  Door,
  PencilSimple,
  Trash,
  Users,
  MapPin,
  Circle,
} from '@phosphor-icons/react';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { initializeRoomsData, deleteRoom, fetchBookings } from '@/features/rooms/store/roomsThunks';
import {
  selectAllRooms,
  selectRoomsLoading,
  selectRoomFilters,
  selectRoomBookings,
  setFilters,
  clearFilters,
} from '@/features/rooms/store/roomsSlice';
import type { Room, RoomType, RoomStatus } from '@/features/rooms/types';
import { ROOM_TYPE_LABELS, ROOM_STATUS_LABELS } from '@/features/rooms/types';
import { ROOM_STATUS_STYLES } from '@/features/rooms/constants';
import { RoomFormModal } from '@/features/rooms/components/modals/RoomFormModal';
import { BookingModal } from '@/features/rooms/components/modals/BookingModal';
import { RoomDetailPanel } from '@/features/rooms/components/detail/RoomDetailPanel';
import { Drawer } from '@/components/ui/drawer';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type AvailabilityFilter = 'all' | 'available' | 'booked';

export function RoomsPage() {
  const dispatch = useAppDispatch();
  useDocumentTitle('Rooms - Admin');

  const currentOrganizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const rooms = useAppSelector(selectAllRooms);
  const loading = useAppSelector(selectRoomsLoading);
  const filters = useAppSelector(selectRoomFilters);
  const bookings = useAppSelector(selectRoomBookings);

  const [searchQuery, setSearchQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | undefined>(undefined);
  const [roomToDelete, setRoomToDelete] = useState<Room | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);

  const bookedRoomIds = useMemo(() => {
    const now = new Date();
    const ids = new Set<string>();
    for (const booking of bookings) {
      if (booking.status !== 'confirmed') continue;
      const start = new Date(booking.startTime);
      const end = new Date(booking.endTime);
      if (start <= now && end > now) {
        ids.add(booking.roomId);
      }
    }
    return ids;
  }, [bookings]);

  const filteredRooms = useMemo(() => {
    if (availabilityFilter === 'all') return rooms;
    return rooms.filter((room) => {
      const isBooked = bookedRoomIds.has(room.id);
      return availabilityFilter === 'booked' ? isBooked : !isBooked;
    });
  }, [rooms, availabilityFilter, bookedRoomIds]);

  useEffect(() => {
    if (!currentOrganizationId) return;
    dispatch(
      initializeRoomsData({
        organizationId: currentOrganizationId,
        searchQuery: filters.searchQuery || undefined,
        roomType: filters.roomType || undefined,
        status: filters.status || undefined,
      }),
    );
  }, [dispatch, currentOrganizationId, filters]);

  useEffect(() => {
    if (!currentOrganizationId) return;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    dispatch(
      fetchBookings({
        organizationId: currentOrganizationId,
        startDate: startOfDay.toISOString(),
        endDate: endOfDay.toISOString(),
      }),
    );
  }, [dispatch, currentOrganizationId]);

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      dispatch(setFilters({ searchQuery: query }));
    },
    [dispatch],
  );

  const handleCreateRoom = useCallback(() => {
    setEditingRoom(undefined);
    setFormOpen(true);
  }, []);

  const handleEditRoom = useCallback((room: Room) => {
    setEditingRoom(room);
    setFormOpen(true);
  }, []);

  const handleDeleteRoom = useCallback((room: Room) => {
    setRoomToDelete(room);
  }, []);

  const confirmDeleteRoom = useCallback(async () => {
    if (!roomToDelete || !currentOrganizationId) return;
    setIsDeleting(true);
    await dispatch(deleteRoom({ roomId: roomToDelete.id, organizationId: currentOrganizationId }));
    setIsDeleting(false);
    setRoomToDelete(null);
  }, [dispatch, roomToDelete, currentOrganizationId]);

  const handleFormClose = useCallback(() => {
    setFormOpen(false);
    setEditingRoom(undefined);
  }, []);

  const handleRowClick = useCallback((room: Room) => {
    setSelectedRoomId(room.id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedRoomId(null);
  }, []);

  const handleBookFromDetail = useCallback(() => {
    setBookingModalOpen(true);
  }, []);

  const handleBookingModalClose = useCallback(() => {
    setBookingModalOpen(false);
  }, []);

  const handleClearFilters = useCallback(() => {
    dispatch(clearFilters());
    setSearchQuery('');
    setAvailabilityFilter('all');
  }, [dispatch]);

  const hasActiveFilters = !!(filters.roomType || filters.status || filters.searchQuery || availabilityFilter !== 'all');

  const typeFilters: { value: RoomType | null; label: string }[] = [
    { value: null, label: 'All' },
    ...Object.entries(ROOM_TYPE_LABELS).map(([key, label]) => ({
      value: key as RoomType,
      label,
    })),
  ];

  const statusFilters: { value: RoomStatus | null; label: string }[] = [
    { value: null, label: 'All' },
    ...Object.entries(ROOM_STATUS_LABELS).map(([key, label]) => ({
      value: key as RoomStatus,
      label,
    })),
  ];

  const availabilityFilters: { value: AvailabilityFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'available', label: 'Available' },
    { value: 'booked', label: 'Booked' },
  ];

  const availableCount = rooms.filter((r) => !bookedRoomIds.has(r.id)).length;
  const bookedCount = rooms.filter((r) => bookedRoomIds.has(r.id)).length;

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Rooms & Resources</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage bookable rooms, meeting spaces, and shared resources for your organization.
          </p>
        </div>
        <Button onClick={handleCreateRoom} className="shrink-0">
          <Plus size={16} weight="bold" className="mr-1.5" />
          New Room
        </Button>
      </div>

      <div className="space-y-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <MagnifyingGlass
              size={16}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Search rooms..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className={cn(
                'w-full rounded-md border border-border bg-input py-1.5 pl-8 pr-3 text-sm',
                'text-foreground placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-1 focus:ring-ring',
              )}
            />
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Type:</span>
            <div className="flex items-center gap-1">
              {typeFilters.map((f) => (
                <button
                  key={f.value ?? 'all-type'}
                  onClick={() => dispatch(setFilters({ roomType: f.value }))}
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                    filters.roomType === f.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Status:</span>
            <div className="flex items-center gap-1">
              {statusFilters.map((f) => (
                <button
                  key={f.value ?? 'all-status'}
                  onClick={() => dispatch(setFilters({ status: f.value }))}
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                    filters.status === f.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Availability:</span>
            <div className="flex items-center gap-1">
              {availabilityFilters.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setAvailabilityFilter(f.value)}
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                    availabilityFilter === f.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label}
                  {f.value === 'available' && rooms.length > 0 && (
                    <span className="ml-1 opacity-70">{availableCount}</span>
                  )}
                  {f.value === 'booked' && rooms.length > 0 && (
                    <span className="ml-1 opacity-70">{bookedCount}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-lg border border-border overflow-hidden">
      {loading.rooms ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : filteredRooms.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Door size={48} weight="duotone" className="mb-3 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No rooms found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {hasActiveFilters
              ? 'Try adjusting your filters'
              : 'Create your first room to get started'}
          </p>
          {!hasActiveFilters && (
            <Button variant="outline" size="sm" className="mt-4" onClick={handleCreateRoom}>
              <Plus size={14} className="mr-1" />
              New Room
            </Button>
          )}
        </div>
      ) : (
        <div className="h-full overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted [&_th]:bg-muted">
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="hidden md:table-cell px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
                <th className="hidden sm:table-cell px-4 py-3 text-left font-medium text-muted-foreground">Location</th>
                <th className="hidden lg:table-cell px-4 py-3 text-center font-medium text-muted-foreground">Capacity</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Availability</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRooms.map((room) => {
                const isBooked = bookedRoomIds.has(room.id);
                return (
                <tr
                  key={room.id}
                  className={cn(
                    "border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer",
                    selectedRoomId === room.id && "bg-primary/5",
                  )}
                  onClick={() => handleRowClick(room)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Door size={16} weight="duotone" className="text-muted-foreground shrink-0" />
                      <div>
                        <p className="font-medium text-foreground">{room.name}</p>
                        <p className="text-xs text-muted-foreground md:hidden">
                          {ROOM_TYPE_LABELS[room.roomType]}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden md:table-cell px-4 py-3">
                    <Badge variant="secondary" className="text-xs">
                      {ROOM_TYPE_LABELS[room.roomType]}
                    </Badge>
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <MapPin size={14} className="shrink-0" />
                      <span className="truncate max-w-[200px]">
                        {[room.building, room.floor, room.location].filter(Boolean).join(', ') || '-'}
                      </span>
                    </div>
                  </td>
                  <td className="hidden lg:table-cell px-4 py-3 text-center">
                    {room.capacity > 0 ? (
                      <span className="flex items-center justify-center gap-1 text-muted-foreground">
                        <Users size={14} />
                        {room.capacity}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                        ROOM_STATUS_STYLES[room.status]?.bg,
                      )}
                    >
                      {ROOM_STATUS_LABELS[room.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {room.status === 'active' ? (
                      <span className={cn(
                        'inline-flex items-center gap-1.5 text-xs font-medium',
                        isBooked
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-green-600 dark:text-green-400',
                      )}>
                        <Circle size={8} weight="fill" />
                        {isBooked ? 'Booked' : 'Available'}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEditRoom(room); }}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title="Edit room"
                      >
                        <PencilSimple size={16} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteRoom(room); }}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-colors"
                        title="Delete room"
                      >
                        <Trash size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>

      <RoomFormModal
        isOpen={formOpen}
        onClose={handleFormClose}
        room={editingRoom}
      />

      <ConfirmDialog
        isOpen={!!roomToDelete}
        onClose={() => setRoomToDelete(null)}
        onConfirm={confirmDeleteRoom}
        title="Delete Room"
        message={`Are you sure you want to delete "${roomToDelete?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={isDeleting}
      />

      <Drawer
        open={!!selectedRoomId}
        onClose={handleCloseDetail}
        side="right"
        className="w-96"
        showClose={false}
        ariaLabel="Room details"
      >
        {selectedRoomId && (
          <RoomDetailPanel
            roomId={selectedRoomId}
            onClose={handleCloseDetail}
            onBook={handleBookFromDetail}
          />
        )}
      </Drawer>

      {selectedRoomId && (
        <BookingModal
          isOpen={bookingModalOpen}
          onClose={handleBookingModalClose}
          roomId={selectedRoomId}
          roomName={rooms.find((r) => r.id === selectedRoomId)?.name}
        />
      )}
    </div>
  );
}
