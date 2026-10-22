import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { AppHeader } from "@/components/layout/AppHeader";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { cn } from "@/shared/utils/cn";
import { effectiveDayKey } from "@/shared/utils/dateFormatting";
import { ApprovalsInbox } from "@/features/projects/components/time/ApprovalsInbox";
import { MyTimeWeek } from "@/features/projects/components/time/MyTimeWeek";
import { selectReview, selectTimePolicy } from "@/features/projects/store/timeSlice";
import { fetchReviewTimesheets } from "@/features/projects/store/timeThunks";

type Tab = "week" | "approvals";

const TAB_OPTIONS: { value: Tab; content: string }[] = [
  { value: "week", content: "My week" },
  { value: "approvals", content: "Approvals" },
];

export function MyTimePage() {
  useDocumentTitle("My time");
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const policy = useAppSelector(selectTimePolicy);
  const review = useAppSelector(selectReview);
  const today = effectiveDayKey(new Date());
  const approvals = policy?.approvalsEnabled ?? false;

  // One probe of the inbox decides whether the Approvals tab exists for this person.
  useEffect(() => {
    if (approvals && !review.loaded && !review.loading) {
      void dispatch(fetchReviewTimesheets({ periodStart: today }));
    }
  }, [dispatch, approvals, review.loaded, review.loading, today]);

  const showApprovals = approvals && (review.rows.length > 0 || review.viewerIsTimekeepingAdmin);
  const tab: Tab = showApprovals && searchParams.get("tab") === "approvals" ? "approvals" : "week";
  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    if (next === "approvals") params.set("tab", "approvals");
    else params.delete("tab");
    setSearchParams(params, { replace: true });
  };
  const tabs = showApprovals ? (
    <SegmentedControl
      value={tab}
      onChange={setTab}
      options={TAB_OPTIONS}
      ariaLabel="My time section"
      className="mr-2"
    />
  ) : null;

  return (
    <>
      <AppHeader />
      <div
        className={cn(
          "flex flex-col overflow-hidden transition-[height] duration-300",
          isZenMode ? "h-dvh" : "h-[calc(100dvh-3rem)]",
        )}
      >
        {tab === "approvals" ? (
          <ApprovalsInbox initialDay={searchParams.get("period") || today} headerExtra={tabs} />
        ) : (
          <MyTimeWeek initialDay={searchParams.get("day") || undefined} headerExtra={tabs} />
        )}
      </div>
    </>
  );
}
