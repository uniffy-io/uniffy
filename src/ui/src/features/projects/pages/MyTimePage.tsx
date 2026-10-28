import { useEffect, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { AppHeader } from "@/components/layout/AppHeader";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { cn } from "@/shared/utils/cn";
import { effectiveDayKey } from "@/shared/utils/dateFormatting";
import { ApprovalsInbox } from "@/features/projects/components/time/ApprovalsInbox";
import { MyTimeWeek } from "@/features/projects/components/time/MyTimeWeek";
import { selectReviewEligibility, selectTimePolicy } from "@/features/projects/store/timeSlice";
import { fetchReviewEligibility } from "@/features/projects/store/timeThunks";

type Tab = "week" | "approvals";

const TAB_OPTIONS: { value: Tab; content: ReactNode }[] = [
  { value: "week", content: <span className="flex h-3.5 items-center px-1 text-xs">My week</span> },
  {
    value: "approvals",
    content: <span className="flex h-3.5 items-center px-1 text-xs">Approvals</span>,
  },
];

export function MyTimePage() {
  useDocumentTitle("My time");
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const policy = useAppSelector(selectTimePolicy);
  const eligibility = useAppSelector(selectReviewEligibility);
  const today = effectiveDayKey(new Date());
  const approvals = policy?.approvalsEnabled ?? false;

  // One probe of the inbox decides whether the Approvals tab exists for this person.
  useEffect(() => {
    if (approvals && !eligibility.loaded && !eligibility.loading) {
      void dispatch(fetchReviewEligibility(today));
    }
  }, [dispatch, approvals, eligibility.loaded, eligibility.loading, today]);

  const showApprovals = approvals && eligibility.eligible;
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
      className="h-7"
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
          <MyTimeWeek
            key={searchParams.get("day") || "today"}
            initialDay={searchParams.get("day") || undefined}
            headerExtra={tabs}
          />
        )}
      </div>
    </>
  );
}
