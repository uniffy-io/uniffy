import { useAppSelector } from "@/app/hooks";
import { AppHeader } from "@/components/layout/AppHeader";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { cn } from "@/shared/utils/cn";
import { MyTimeWeek } from "@/features/projects/components/time/MyTimeWeek";

export function MyTimePage() {
  useDocumentTitle("My time");
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);

  return (
    <>
      <AppHeader />
      <div
        className={cn(
          "flex flex-col overflow-hidden transition-[height] duration-300",
          isZenMode ? "h-dvh" : "h-[calc(100dvh-3rem)]",
        )}
      >
        <MyTimeWeek />
      </div>
    </>
  );
}
