import { useAppSelector } from "@/app/hooks";
import { selectSessionCall } from "@/features/calls/store/callsSlice";
import { canPublishInCall } from "@/features/calls/utils/callPublishing";

export function useCallPublishing() {
  const call = useAppSelector(selectSessionCall);
  const userId = useAppSelector((s) => s.auth.user?.id ?? "");
  return { call, canPublish: canPublishInCall(call, userId) };
}
