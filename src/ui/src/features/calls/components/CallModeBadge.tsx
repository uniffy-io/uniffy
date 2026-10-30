import { Presentation } from "@phosphor-icons/react";
import { useCallPublishing } from "@/features/calls/hooks/useCallPublishing";
import { canPublishInCall } from "@/features/calls/utils/callPublishing";

export function CallModeBadge() {
  const { call } = useCallPublishing();
  if (!call?.townHall) return null;
  const audience = new Set(
    call.participants.filter((p) => !canPublishInCall(call, p.userId)).map((p) => p.userId),
  ).size;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Presentation size={12} />
      <span className="truncate">Town hall · {audience} listening</span>
    </span>
  );
}
