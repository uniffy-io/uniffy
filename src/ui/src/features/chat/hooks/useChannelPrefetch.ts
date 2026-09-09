import { useCallback, useEffect, useRef } from "react";
import { useAppDispatch } from "@/app/hooks";
import { prefetchChannelMessages } from "@/features/chat/store/chatThunks";

export function useChannelPrefetch(channelId: string, isActive: boolean) {
  const dispatch = useAppDispatch();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel, channelId, isActive]);

  const schedule = useCallback(() => {
    cancel();
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection;
    if (isActive || connection?.saveData) return;
    // Ignore the pointer passing across rows on its way to another target.
    timer.current = setTimeout(() => {
      timer.current = null;
      void dispatch(prefetchChannelMessages(channelId));
    }, 100);
  }, [cancel, channelId, dispatch, isActive]);

  return { onPointerEnter: schedule, onPointerLeave: cancel, onFocus: schedule, onBlur: cancel };
}
