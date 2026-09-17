import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckSquare, ArrowRight } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import {
  WidgetCard,
  EmptyWidget,
  WidgetSkeleton,
} from "@/features/dashboard/components/widgets/WidgetCard";
import { MyTaskSection } from "@/features/dashboard/components/widgets/MyTaskSection";
import { MyTasksDialog } from "@/features/dashboard/components/MyTasksDialog";
import { useMyTasks } from "@/features/dashboard/hooks/useMyTasks";

const MAX_TASKS = 8;

export function MyTasksWidget() {
  const navigate = useNavigate();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const hasTasks = useAppSelector((state) => Object.keys(state.projects.tasks).length > 0);
  const projects = useAppSelector((state) => state.projects.projects);
  const isLoading = useAppSelector((state) => state.projects.loading.tasks);
  const { overdue, dueToday, upcoming, totalCount } = useMyTasks();

  const isEmpty = totalCount === 0 && !isLoading;
  const overdueRows = Math.min(overdue.length, MAX_TASKS);
  const todayRows = Math.min(dueToday.length, MAX_TASKS - overdueRows);
  const upcomingRows = MAX_TASKS - overdueRows - todayRows;

  return (
    <>
      <WidgetCard
        title="My Tasks"
        icon={CheckSquare}
        colSpan={2}
        minHeight="200px"
        priority={1}
        footer={
          totalCount > 0 ? (
            <button
              type="button"
              onClick={() => setIsDialogOpen(true)}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              View all {totalCount} tasks
              <ArrowRight size={12} />
            </button>
          ) : null
        }
      >
        {isLoading && !hasTasks ? (
          <WidgetSkeleton rows={4} />
        ) : isEmpty ? (
          <EmptyWidget
            icon={CheckSquare}
            title="No tasks assigned"
            description="Browse projects to find work"
            action={{
              label: "Browse projects",
              onClick: () => navigate("/projects"),
            }}
          />
        ) : (
          <div className="space-y-1">
            <MyTaskSection
              label="Overdue"
              tone="overdue"
              tasks={overdue}
              projects={projects}
              limit={overdueRows}
            />
            <MyTaskSection
              label="Due today"
              tone="today"
              tasks={dueToday}
              projects={projects}
              limit={todayRows}
            />
            <MyTaskSection
              label="Upcoming"
              tone="upcoming"
              tasks={upcoming}
              projects={projects}
              limit={upcomingRows}
            />
          </div>
        )}
      </WidgetCard>
      {isDialogOpen && <MyTasksDialog initialView="all" onClose={() => setIsDialogOpen(false)} />}
    </>
  );
}
