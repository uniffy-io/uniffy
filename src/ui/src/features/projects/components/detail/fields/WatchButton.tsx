import { useEffect, useState } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { projectsApi } from "@/features/projects/api/projectsApi";
import { cn } from "@/shared/utils/cn";

export function WatchButton({ taskId }: { taskId: string }) {
  const [isWatching, setIsWatching] = useState(false);
  const [watcherCount, setWatcherCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const orgId = useAppSelector((state) => state.auth.currentOrganizationId);

  useEffect(() => {
    if (!orgId) return;
    projectsApi.listTaskWatchers(taskId, orgId).then((res) => {
      setWatcherCount(res.watcherCount);
    });
    projectsApi.bulkCheckTaskWatchers([taskId], orgId).then((res) => {
      setIsWatching(res.watchedTasks[taskId] ?? false);
    });
  }, [taskId, orgId]);

  const handleToggle = async () => {
    if (!orgId || isLoading) return;
    setIsLoading(true);
    try {
      const res = await projectsApi.toggleTaskWatcher(taskId, orgId);
      setIsWatching(res.isWatching);
      setWatcherCount((c) => c + (res.isWatching ? 1 : -1));
    } finally {
      setIsLoading(false);
    }
  };

  const WatchIcon = isWatching ? Eye : EyeSlash;

  return (
    <button
      onClick={handleToggle}
      disabled={isLoading}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors",
        isWatching
          ? "text-primary bg-primary/10"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
      title={isWatching ? "Stop watching" : "Watch this task"}
    >
      <WatchIcon size={14} weight={isWatching ? "fill" : "regular"} />
      {watcherCount > 0 && <span>{watcherCount}</span>}
    </button>
  );
}
