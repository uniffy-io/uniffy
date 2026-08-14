import { useEffect, useMemo, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { fetchAvailableRoomIds } from "@/features/rooms/store/roomsThunks";
import {
  selectAvailableRoomIds,
  clearAvailableRoomIds,
  selectRoomsLoading,
} from "@/features/rooms/store/roomsSlice";

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

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      dispatch(fetchAvailableRoomIds({ organizationId, startTime, endTime }));
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [dispatch, startTime, endTime, organizationId]);

  useEffect(() => {
    return () => {
      dispatch(clearAvailableRoomIds());
    };
  }, [dispatch]);

  const availableRoomIds = useMemo(() => (rawIds ? new Set(rawIds) : null), [rawIds]);

  return { availableRoomIds, loading };
}
