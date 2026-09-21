import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useAppSelector } from "@/app/hooks";
import { useMyTasks } from "@/features/dashboard/hooks/useMyTasks";
import { MyTaskSection } from "@/features/dashboard/components/widgets/MyTaskSection";

export type MyTasksView = "overdue" | "dueToday" | "upcoming" | "all";

const VIEWS: { value: MyTasksView; label: string }[] = [
  { value: "overdue", label: "Overdue" },
  { value: "dueToday", label: "Due today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "all", label: "All" },
];

const EMPTY_COPY: Record<MyTasksView, string> = {
  overdue: "Nothing is overdue.",
  dueToday: "Nothing is due today.",
  upcoming: "No upcoming tasks.",
  all: "No open tasks are assigned to you.",
};

interface MyTasksDialogProps {
  initialView: MyTasksView;
  onClose: () => void;
}

export function MyTasksDialog({ initialView, onClose }: MyTasksDialogProps) {
  const [view, setView] = useState<MyTasksView>(initialView);
  const projects = useAppSelector((state) => state.projects.projects);
  const { overdue, dueToday, upcoming, totalCount } = useMyTasks();

  const counts: Record<MyTasksView, number> = {
    overdue: overdue.length,
    dueToday: dueToday.length,
    upcoming: upcoming.length,
    all: totalCount,
  };
  const sections = [
    { view: "overdue", label: "Overdue", tone: "overdue", tasks: overdue },
    { view: "dueToday", label: "Due today", tone: "today", tasks: dueToday },
    { view: "upcoming", label: "Upcoming", tone: "upcoming", tasks: upcoming },
  ] as const;

  return (
    <Modal onClose={onClose} maxWidth="max-w-xl" anchor="top">
      <ModalHeader
        title="My tasks"
        description="Open tasks assigned to you across your projects."
        className="shrink-0"
      />
      <div className="shrink-0 px-6 pt-4">
        <SegmentedControl
          value={view}
          onChange={setView}
          ariaLabel="Task group"
          className="w-fit max-w-full"
          options={VIEWS.map(({ value, label }) => ({
            value,
            content: (
              <span className="flex items-center gap-1.5 px-1.5 text-xs font-medium whitespace-nowrap">
                {label}
                {/* Counts stay in the section headers on phones, where four pills do not fit. */}
                <span className="hidden sm:inline rounded-full bg-muted px-1.5 text-[11px]">
                  {counts[value]}
                </span>
              </span>
            ),
          }))}
        />
      </div>
      <ModalBody scrollable={false} className="flex-1 min-h-0 overflow-y-auto space-y-3">
        {counts[view] === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{EMPTY_COPY[view]}</p>
        ) : (
          sections
            .filter((section) => view === "all" || view === section.view)
            .map((section) => (
              <MyTaskSection
                key={section.view}
                label={section.label}
                tone={section.tone}
                tasks={section.tasks}
                projects={projects}
              />
            ))
        )}
      </ModalBody>
      <ModalFooter className="shrink-0">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}
