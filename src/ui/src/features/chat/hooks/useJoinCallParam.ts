import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppDispatch } from "@/app/hooks";
import { prejoinOpened } from "@/features/calls/store/callsSlice";

/** Shared with the backend link builder in `domains/notifications/email_content.py`. */
export const JOIN_CALL_PARAM = "call";
export const JOIN_CALL_VALUE = "join";

/**
 * Opens pre-join for a channel arrived at from a meeting reminder sent by mail
 * or browser push. Those land from outside the app, so the join intent travels
 * as a query param; it is consumed once and stripped so a refresh or a back
 * navigation does not re-open the modal.
 */
export function useJoinCallParam(channelId: string | null | undefined) {
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const consumedFor = useRef<string | null>(null);

  const wantsJoin = searchParams.get(JOIN_CALL_PARAM) === JOIN_CALL_VALUE;

  useEffect(() => {
    if (!channelId || !wantsJoin) return;
    if (consumedFor.current === channelId) return;
    consumedFor.current = channelId;

    dispatch(prejoinOpened({ channelId }));

    const next = new URLSearchParams(searchParams);
    next.delete(JOIN_CALL_PARAM);
    setSearchParams(next, { replace: true });
  }, [channelId, wantsJoin, dispatch, searchParams, setSearchParams]);
}
