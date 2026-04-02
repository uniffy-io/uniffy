/**
 * Hook for checking room availability over a date range.
 *
 * Dispatches the checkAvailability thunk and returns the time slots
 * with a computed isAvailable flag indicating whether all slots are free.
 */

import { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { checkAvailability } from '@/features/rooms/store/roomsThunks';
import { selectRoomAvailability } from '@/features/rooms/store/roomsSlice';

export function useRoomAvailability(
  roomId: string | null,
  startTime?: string,
  endTime?: string,
) {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const availability = useAppSelector((state) =>
    selectRoomAvailability(state, roomId || ''),
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!roomId || !startTime || !endTime || !organizationId) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag tied to async dispatch lifecycle
    setLoading(true);
    dispatch(
      checkAvailability({
        organizationId,
        roomId,
        startDate: startTime,
        endDate: endTime,
      }),
    ).finally(() => {
      setLoading(false);
    });
  }, [roomId, startTime, endTime, organizationId, dispatch]);

  const isAvailable = availability.length > 0
    ? availability.every((s) => s.isAvailable)
    : true;

  return { slots: availability, isAvailable, loading };
}
