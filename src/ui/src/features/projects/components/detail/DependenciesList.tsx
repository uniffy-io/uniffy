import { LinkBreak, WarningCircle } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { selectTasksMap } from "../../store/projectsSlice";
import { Badge } from "@/components/ui/badge";

interface DependenciesListProps {
  blockedByTaskIds: string[];
}

export function DependenciesList({ blockedByTaskIds }: DependenciesListProps) {
  if (!blockedByTaskIds || blockedByTaskIds.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
        Blocked By
        <LinkBreak size={12} />
      </h3>
      
      <div className="space-y-2">
        {blockedByTaskIds.map(id => (
          <DependencyItem key={id} taskId={id} />
        ))}
      </div>
    </div>
  );
}

function DependencyItem({ taskId }: { taskId: string }) {
  const task = useAppSelector((state) => selectTasksMap(state)[taskId]);
  
  if (!task) return null;
  
  const isCompleted = !!task.completedAt;

  return (
    <div className="flex items-center justify-between p-2 rounded-md border border-border bg-card">
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium truncate">{task.title}</span>
        <span className="text-xs text-muted-foreground">{task.id}</span>
      </div>
      
      {!isCompleted && (
        <Badge variant="outline" className="text-xs gap-1" style={{ color: 'var(--status-warning)', borderColor: 'color-mix(in srgb, var(--status-warning) 50%, transparent)', backgroundColor: 'color-mix(in srgb, var(--status-warning) 10%, transparent)' }}>
          <WarningCircle size={10} weight="fill" />
          Blocking
        </Badge>
      )}
      
      {isCompleted && (
        <Badge variant="outline" className="text-xs bg-muted text-muted-foreground">
          Done
        </Badge>
      )}
    </div>
  );
}
