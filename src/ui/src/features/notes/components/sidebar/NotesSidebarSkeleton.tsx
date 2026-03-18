import { Skeleton } from '@/components/ui/skeleton';

export function NotesSidebarSkeleton() {
  return (
    <div className="space-y-3 px-2 py-2 animate-in fade-in-0 duration-300">
      {/* Section headers + items */}
      {[1, 2, 3].map((section) => (
        <div key={section} className="space-y-1">
          {/* Section header */}
          <div className="flex items-center gap-2 px-2 py-2">
            <Skeleton variant="rectangular" className="w-4 h-4" />
            <Skeleton variant="rectangular" className="w-4 h-4" />
            <Skeleton variant="text" className="w-20 h-3.5" />
          </div>
          {/* Tree items */}
          <div className="ml-4 pl-2 border-l border-border space-y-1">
            {Array.from({ length: section === 1 ? 4 : 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                <Skeleton variant="rectangular" className="w-4 h-4" />
                <Skeleton
                  variant="text"
                  className={`h-3 ${i % 3 === 0 ? 'w-28' : i % 3 === 1 ? 'w-20' : 'w-24'}`}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
