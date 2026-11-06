import { useState } from "react";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { refreshCalendarSubscription } from "@/features/calendar/store";
import type { CalendarInfo } from "@/features/calendar/types";
import { subscriptionErrorCopy } from "@/features/calendar/utils/subscriptionCopy";

interface SubscriptionStatusProps {
  calendar: CalendarInfo;
}

/** The line under a subscribed calendar's row: syncing, paused, or what broke and a Retry. */
export function SubscriptionStatus({ calendar }: SubscriptionStatusProps) {
  const dispatch = useAppDispatch();
  const [retrying, setRetrying] = useState(false);
  const subscription = calendar.subscription;
  if (!subscription || subscription.state === "healthy") return null;

  if (subscription.state === "pending") {
    return (
      <p
        className="pl-9 pr-2 pb-1 text-xs text-subtle-foreground"
        data-testid="subscription-status"
      >
        Syncing...
      </p>
    );
  }
  if (subscription.state === "paused") {
    return (
      <p
        className="pl-9 pr-2 pb-1 text-xs text-subtle-foreground"
        data-testid="subscription-status"
      >
        Paused by your organization
      </p>
    );
  }

  const retry = async () => {
    setRetrying(true);
    await dispatch(refreshCalendarSubscription(calendar.id));
    setRetrying(false);
  };

  return (
    <div
      className="flex items-center gap-2 pl-9 pr-2 pb-1 text-xs text-destructive"
      data-testid="subscription-status"
      role="status"
    >
      <span className="min-w-0 flex-1">{subscriptionErrorCopy(subscription)}</span>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => void retry()}
        loading={retrying}
        className="shrink-0"
      >
        Retry
      </Button>
    </div>
  );
}
