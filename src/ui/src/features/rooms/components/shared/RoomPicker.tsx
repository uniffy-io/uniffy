/**
 * RoomPicker - Reusable room selector for embedding in forms
 *
 * Provides a button that toggles a dropdown with search, amenity filter,
 * and room list. Shows availability status when startTime/endTime are provided.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Door, X, MagnifyingGlass, Users, Check, Circle, Funnel } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { fetchRooms } from '@/features/rooms/store/roomsThunks';
import { usePickerAvailability } from '@/features/rooms/hooks/usePickerAvailability';
import {
  selectAllRooms,
  selectRoomsLoading,
} from '@/features/rooms/store/roomsSlice';
import { ROOM_TYPE_LABELS } from '@/features/rooms/types';
import { AMENITY_ICONS } from '@/features/rooms/constants';
import type { Room } from '@/features/rooms/types';

interface RoomPickerProps {
  selectedRoomId: string | null;
  onSelect: (roomId: string | null) => void;
  organizationId: string;
  startTime?: string;
  endTime?: string;
  className?: string;
}

/**
 * Collect all unique amenities across rooms for the filter.
 */
function collectAmenities(rooms: Room[]): string[] {
  const set = new Set<string>();
  for (const room of rooms) {
    for (const a of room.amenities) {
      set.add(a);
    }
  }
  return Array.from(set).sort();
}

export function RoomPicker({
  selectedRoomId,
  onSelect,
  organizationId,
  startTime,
  endTime,
  className,
}: RoomPickerProps) {
  const dispatch = useAppDispatch();
  const rooms = useAppSelector(selectAllRooms);
  const loading = useAppSelector(selectRoomsLoading);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [requiredAmenities, setRequiredAmenities] = useState<Set<string>>(new Set());
  const [showAmenityFilter, setShowAmenityFilter] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  // Fetch rooms once per (org) mount. Gating on ``rooms.length === 0``
  // would loop forever for orgs with no rooms: the fulfilled action
  // leaves ``loading.rooms`` false and the empty list as-is, so the
  // dep tuple fires again on each commit.
  const fetchedForOrg = useRef<string | null>(null);
  useEffect(() => {
    if (fetchedForOrg.current === organizationId) return;
    fetchedForOrg.current = organizationId;
    dispatch(fetchRooms({ organizationId }));
  }, [dispatch, organizationId]);

  const selectedRoom = useMemo(
    () => (selectedRoomId ? rooms.find((r) => r.id === selectedRoomId) : null),
    [rooms, selectedRoomId],
  );

  const allAmenities = useMemo(() => collectAmenities(rooms), [rooms]);

  const filteredRooms = useMemo(() => {
    let result = rooms.filter((r) => r.status === 'active');

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.location.toLowerCase().includes(q) ||
          ROOM_TYPE_LABELS[r.roomType].toLowerCase().includes(q),
      );
    }

    if (requiredAmenities.size > 0) {
      result = result.filter((r) =>
        Array.from(requiredAmenities).every((a) => r.amenities.includes(a)),
      );
    }

    return result;
  }, [rooms, search, requiredAmenities]);

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 320),
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      const handleScroll = () => updatePosition();
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', handleScroll);
      return () => {
        window.removeEventListener('scroll', handleScroll, true);
        window.removeEventListener('resize', handleScroll);
      };
    }
  }, [isOpen, updatePosition]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  const handleSelectRoom = (room: Room) => {
    onSelect(room.id);
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(null);
  };

  const toggleAmenity = (amenity: string) => {
    setRequiredAmenities((prev) => {
      const next = new Set(prev);
      if (next.has(amenity)) {
        next.delete(amenity);
      } else {
        next.add(amenity);
      }
      return next;
    });
  };

  // Check availability for the selected time range
  const { availableRoomIds } = usePickerAvailability(startTime, endTime, organizationId);

  const dropdown = isOpen && position ? createPortal(
    <div
      ref={dropdownRef}
      data-room-picker-portal=""
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: position.width,
      }}
      className={cn(
        'z-200 rounded-lg border border-border bg-card shadow-xl',
        'animate-in fade-in-0 slide-in-from-top-2 duration-100',
      )}
    >
      {/* Search + amenity filter toggle */}
      <div className="p-2 border-b border-border space-y-2">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <MagnifyingGlass
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rooms..."
              className="h-8 pl-8 text-sm"
              autoFocus
            />
          </div>
          {allAmenities.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAmenityFilter(!showAmenityFilter)}
              className={cn(
                'shrink-0 p-1.5 rounded-md transition-colors',
                showAmenityFilter || requiredAmenities.size > 0
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
              title="Filter by amenities"
            >
              <Funnel size={16} weight={requiredAmenities.size > 0 ? 'fill' : 'regular'} />
            </button>
          )}
        </div>

        {/* Amenity filter chips */}
        {showAmenityFilter && (
          <div className="flex flex-wrap gap-1">
            {allAmenities.map((amenity) => {
              const isActive = requiredAmenities.has(amenity);
              const IconComponent = AMENITY_ICONS[amenity];
              return (
                <button
                  key={amenity}
                  type="button"
                  onClick={() => toggleAmenity(amenity)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground',
                  )}
                >
                  {IconComponent && <IconComponent size={10} />}
                  {amenity}
                </button>
              );
            })}
          </div>
        )}

        {/* Clear all filters */}
        {(search.trim() || requiredAmenities.size > 0) && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setRequiredAmenities(new Set());
            }}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Room list */}
      <div className="max-h-60 overflow-y-auto py-1">
        {loading.rooms ? (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            Loading rooms...
          </div>
        ) : filteredRooms.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            No rooms found
          </div>
        ) : (
          filteredRooms.map((room) => {
            const isSelected = room.id === selectedRoomId;
            // If we have time-based availability data, use it; otherwise null
            const availability = availableRoomIds ? availableRoomIds.has(room.id) : null;
            return (
              <button
                key={room.id}
                type="button"
                onClick={() => handleSelectRoom(room)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                  isSelected ? 'bg-primary/10' : 'hover:bg-muted',
                )}
              >
                <Door size={16} weight="duotone" className="text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">
                      {room.name}
                    </span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {ROOM_TYPE_LABELS[room.roomType]}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-0.5">
                      <Users size={10} />
                      {room.capacity}
                    </span>
                    {room.location && (
                      <span className="truncate max-w-30">{room.location}</span>
                    )}
                  </div>
                </div>
                {/* Availability indicator */}
                {availability !== null && (
                  <span
                    className={cn(
                      'shrink-0 flex items-center gap-1 text-[10px] font-medium',
                      availability
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400',
                    )}
                  >
                    <Circle size={6} weight="fill" />
                    {availability ? 'Available' : 'Booked'}
                  </span>
                )}
                {isSelected && (
                  <Check size={16} weight="bold" className="text-primary shrink-0" />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div className={cn('relative', className)}>
      {selectedRoom ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5">
          <Door size={14} weight="duotone" className="text-muted-foreground shrink-0" />
          <span className="text-sm font-medium text-foreground truncate flex-1">
            {selectedRoom.name}
          </span>
          <button
            type="button"
            onClick={handleClear}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={14} weight="bold" />
          </button>
        </div>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            'flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 w-full',
            'text-sm text-muted-foreground hover:bg-muted/50 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background',
          )}
        >
          <Door size={16} weight="duotone" />
          <span>Select a room...</span>
        </button>
      )}

      {dropdown}
    </div>
  );
}
