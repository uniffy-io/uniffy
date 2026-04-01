/**
 * usePickerAvailability - Debounced availability check for the RoomPicker.
 *
 * Dispatches fetchAvailableRoomIds when start/end times change,
 * returning a Set of available room IDs. Clears on unmount.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { fetchAvailableRoomIds } from '@/features/rooms/store/roomsThunks';
import {
  selectAvailableRoomIds,
  clearAvailableRoomIds,
  selectRoomsLoading,
} from '@/features/rooms/store/roomsSlice';

export function usePickerAvailability(
  startTime: string | undefined,
  endTime: string | undefined,
  organizationId: string,
): { availableRoomIds: Set<string> | null; loading: boolean } {
  const dispatch = useAppDispatch();
  const rawIds = useAppSelector(selectAvailableRoomIds);
  const loading = useAppSelector((state) => selectRoomsLoading(state).availableRooms);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!startTime || !endTime || !organizationId) {
      dispatch(clearAvailableRoomIds());
      return;
    }

    // Debounce 300ms to avoid rapid API calls while user adjusts times
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      dispatch(fetchAvailableRoomIds({ organizationId, startTime, endTime }));
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [dispatch, startTime, endTime, organizationId]);

  // Clear on unmount
  useEffect(() => {
    return () => {
      dispatch(clearAvailableRoomIds());
    };
  }, [dispatch]);

  const availableRoomIds = useMemo(
    () => (rawIds ? new Set(rawIds) : null),
    [rawIds],
  );

  return { availableRoomIds, loading };
}
