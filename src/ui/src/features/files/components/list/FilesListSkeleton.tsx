import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/shared/utils/cn";

interface FilesListSkeletonProps {
  viewMode?: "grid" | "list";
}

export function FilesListSkeleton({ viewMode = "grid" }: FilesListSkeletonProps) {
  if (viewMode === "list") {
    return <ListSkeleton />;
  }
  return <GridSkeleton />;
}

function GridSkeleton() {
  return (
    <div className="p-3 md:p-4 animate-in fade-in-0 duration-300">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton
              variant="rectangular"
              className={cn(
                "w-full aspect-square",
                i % 4 === 0 && "opacity-60",
                i % 4 === 2 && "opacity-80",
              )}
            />
            <Skeleton variant="text" className={`h-3 ${i % 2 === 0 ? "w-4/5" : "w-3/5"}`} />
            <Skeleton variant="text" className="h-2.5 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="animate-in fade-in-0 duration-300">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 md:px-4 py-2.5 border-b border-border">
          <Skeleton variant="rectangular" className="w-8 h-8 shrink-0" />
          <Skeleton
            variant="text"
            className={`h-3.5 flex-1 max-w-[200px] ${i % 2 === 0 ? "" : "max-w-[160px]"}`}
          />
          <Skeleton variant="text" className="h-3 w-16 hidden md:block" />
          <Skeleton variant="text" className="h-3 w-12 hidden lg:block" />
        </div>
      ))}
    </div>
  );
}
