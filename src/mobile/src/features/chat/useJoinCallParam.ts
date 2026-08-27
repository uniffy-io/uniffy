import { useEffect, useRef } from "react";
import { router, useLocalSearchParams } from "expo-router";

/** Shared with the backend link builder in `domains/notifications/email_content.py`. */
export const JOIN_CALL_PARAM = "call";
export const JOIN_CALL_VALUE = "join";

/**
 * Opens pre-join for a channel arrived at from a meeting reminder. The reminder
 * lands from outside the screen - a notification tap, or a push - so the join
 * intent travels as a route param; it is consumed once and cleared so a later
 * return to the same channel does not re-open the sheet.
 */
export function useJoinCallParam(channelId: string, openPrejoin: () => void) {
  const params = useLocalSearchParams<{ call?: string }>();
  const wantsJoin = params[JOIN_CALL_PARAM] === JOIN_CALL_VALUE;
  const consumedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!channelId || !wantsJoin) return;
    if (consumedFor.current === channelId) return;
    consumedFor.current = channelId;

    openPrejoin();
    router.setParams({ [JOIN_CALL_PARAM]: undefined });
  }, [channelId, wantsJoin, openPrejoin]);
}
