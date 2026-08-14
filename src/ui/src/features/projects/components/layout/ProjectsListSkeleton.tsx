import { Skeleton } from "@/components/ui/skeleton";

export function ProjectsListSkeleton() {
  return (
    <div className="px-2 pt-1 pb-2 space-y-1 animate-in fade-in-0 duration-300">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="px-2 py-1.5 space-y-1.5">
          <div className="flex items-center gap-3">
            <Skeleton variant="rectangular" className="w-4 h-4 shrink-0" />
            <Skeleton
              variant="text"
              className={`h-3.5 ${i % 3 === 0 ? "w-32" : i % 3 === 1 ? "w-24" : "w-28"}`}
            />
          </div>
          <div className="pl-7 pr-2 flex items-center gap-2">
            <Skeleton variant="rectangular" className="h-1 flex-1 rounded-full" />
            <Skeleton variant="text" className="w-6 h-2.5" />
          </div>
        </div>
      ))}
    </div>
  );
}
