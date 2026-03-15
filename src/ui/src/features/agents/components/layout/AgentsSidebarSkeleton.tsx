import { Skeleton } from '@/components/ui/skeleton';

export function AgentsSidebarSkeleton() {
  return (
    <div className="px-2 pb-2 space-y-1 animate-in fade-in-0 duration-300">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-start gap-2.5 px-2 py-2 rounded-md">
          <Skeleton variant="circular" className="w-8 h-8 shrink-0" />
          <div className="flex-1 space-y-1.5 pt-0.5">
            <Skeleton
              variant="text"
              className={`h-3.5 ${i % 3 === 0 ? 'w-28' : i % 3 === 1 ? 'w-20' : 'w-32'}`}
            />
            <Skeleton variant="text" className="h-2.5 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}
