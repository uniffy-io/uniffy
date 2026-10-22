import { useParams, useSearchParams } from "react-router-dom";
import { useAppSelector } from "@/app/hooks";
import { AppHeader } from "@/components/layout/AppHeader";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { cn } from "@/shared/utils/cn";
import { effectiveDayKey } from "@/shared/utils/dateFormatting";
import { ReviewWeek } from "@/features/projects/components/time/ReviewWeek";

export function ReviewTimePage() {
  useDocumentTitle("Review time");
  const { userId = "" } = useParams<{ userId: string }>();
  const [searchParams] = useSearchParams();
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const day = searchParams.get("day") || effectiveDayKey(new Date());

  return (
    <>
      <AppHeader />
      <div
        className={cn(
          "flex flex-col overflow-hidden transition-[height] duration-300",
          isZenMode ? "h-dvh" : "h-[calc(100dvh-3rem)]",
        )}
      >
        <ReviewWeek key={userId} userId={userId} initialDay={day} />
      </div>
    </>
  );
}
