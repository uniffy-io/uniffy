import { useMemo, useState } from "react";
import { Group, Panel } from "react-resizable-panels";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useAppDispatch } from "@/app/hooks";
import { ExpandableEditor } from "@/components/editor/ExpandableEditor";
import { MentionChipCompact } from "@/components/mention";
import { PaneSeparator } from "@/components/ui/pane-separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CommentsPanel } from "@/features/comments/components/CommentsPanel";
import {
  type ActivityFilter,
  ActivityFilterSelect,
  ActivityLog,
} from "@/features/projects/components/detail/ActivityLog";
import { DependenciesList } from "@/features/projects/components/detail/DependenciesList";
import { EditableTitle } from "@/features/projects/components/detail/fields/EditableTitle";
import { StatusPicker } from "@/features/projects/components/detail/fields/OptionPickers";
import { SubtasksList } from "@/features/projects/components/detail/SubtasksList";
import { TaskFieldsList } from "@/features/projects/components/detail/TaskFieldsList";
import { TaskPinnedFields } from "@/features/projects/components/detail/TaskPinnedFields";
import { TaskSection } from "@/features/projects/components/detail/TaskSection";
import { WorklogSection } from "@/features/projects/components/time/WorklogSection";
import { useTaskFieldUpdate } from "@/features/projects/hooks/useTaskFieldUpdate";
import { useTaskSections } from "@/features/projects/hooks/useTaskSections";
import { useAppearanceSettings } from "@/features/settings/hooks/useSettings";
import { optimisticUpdateTask } from "@/features/projects/store/projectsSlice";
import { updateTask } from "@/features/projects/store/projectsThunks";
import type { Project, SelectOption, Sprint, Task } from "@/features/projects/types";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import { TagPicker } from "@/features/tags";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import { cn } from "@/shared/utils/cn";
import { extractFallbackLabel, extractMentionsFromMarkdown } from "@/shared/utils/mentionUtils";

export type TaskDetailMode = "sidebar" | "modal" | "page";

interface TaskDetailLayoutProps {
  task: Task;
  project: Project | null;
  allProjectTasks: Task[];
  sprints: Sprint[];
  blocksTaskIds: string[];
  subtaskTimeSpent: number;
  canEdit: boolean;
  mode: TaskDetailMode;
  onDescriptionDone: (
    markdown: string,
    meta: { realtimeOwned: boolean; baseContent: string },
  ) => void;
}

/**
 * The task as a document: title, pinned fields, the description at its own height, then
 * collapsible sections. The layout owns the scrolling, so a host only gives it a sized box.
 */
export function TaskDetailLayout({
  task,
  project,
  allProjectTasks,
  sprints,
  blocksTaskIds,
  subtaskTimeSpent,
  canEdit,
  mode,
  onDescriptionDone,
}: TaskDetailLayoutProps) {
  const dispatch = useAppDispatch();
  const update = useTaskFieldUpdate(task.id);
  const { open, toggle } = useTaskSections();
  const { isDesktop, isWide } = useBreakpoint();
  const { taskPinnedFields: pinned } = useAppearanceSettings();
  // Subtasks share their parent's project, so the list already in hand has them all.
  const subtaskProgress = useMemo(() => {
    const subtasks = allProjectTasks.filter((t) => t.parentId === task.id);
    // A completed parent counts every subtask done, as the list shows them.
    const done = task.completedAt ? subtasks.length : subtasks.filter((t) => t.completedAt).length;
    return { total: subtasks.length, done };
  }, [allProjectTasks, task.id, task.completedAt]);
  // Wide hosts keep the description alone in the reading column and every section in a rail.
  const railed = mode === "page" ? isWide : mode === "modal" && (isDesktop || isWide);
  // The modal and the page keep their own rail width on this device.
  const railLayoutId = `task-detail-${mode}`;
  const [savedRailLayout] = useState(() => loadPanelLayout(railLayoutId));
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");

  const statusField = project?.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.STATUS);
  const statusOption = statusField?.config.options?.find((o) => o.id === task.status);

  // Pinned fields render as pills above the description; the list carries the rest.
  const moreFields = (
    <div className="space-y-3">
      {!pinned.includes("status") && statusOption && statusField && (
        <div className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-sm text-muted-foreground">Status</span>
          <StatusPicker
            currentOption={statusOption}
            options={(statusField.config.options ?? []) as SelectOption[]}
            onSelect={(status) => update({ status })}
            disabled={!canEdit}
          />
        </div>
      )}
      {!pinned.includes("tags") && (
        <div className="flex items-start gap-3">
          <span className="w-20 shrink-0 pt-1 text-sm text-muted-foreground">Tags</span>
          <div className="min-w-0 flex-1">
            <TagPicker
              selectedTagIds={task.tagIds}
              onChange={(tagIds) => update({ tagIds })}
              disabled={!canEdit}
              placeholder="Add a tag"
            />
          </div>
        </div>
      )}
      <TaskFieldsList
        task={task}
        project={project}
        allProjectTasks={allProjectTasks}
        sprints={sprints}
        subtaskTimeSpent={subtaskTimeSpent}
        canEdit={canEdit}
        pinned={pinned}
      />
      <WorklogSection task={task} />
    </div>
  );

  const references = task.outgoingReferences;

  const sections = (
    <>
      <TaskSection
        title="Subtasks"
        count={subtaskProgress.total}
        done={subtaskProgress.done}
        open={open.subtasks}
        onToggle={() => toggle("subtasks")}
        testId="task-section-subtasks"
      >
        <SubtasksList taskId={task.id} parentCompleted={!!task.completedAt} />
      </TaskSection>

      <TaskSection
        title="Dependencies"
        count={task.blockedByTaskIds.length + blocksTaskIds.length}
        open={open.dependencies}
        onToggle={() => toggle("dependencies")}
        testId="task-section-dependencies"
      >
        <DependenciesList
          taskId={task.id}
          blockedByTaskIds={task.blockedByTaskIds}
          blocksTaskIds={blocksTaskIds}
        />
      </TaskSection>

      {references.length > 0 && (
        <TaskSection
          title="References"
          count={references.length}
          open={open.references}
          onToggle={() => toggle("references")}
          testId="task-section-references"
        >
          <div className="flex flex-wrap gap-2">
            {references.map((urn) => {
              const mention = extractMentionsFromMarkdown(task.description).find(
                (m) => m.urn === urn,
              );
              return (
                <MentionChipCompact
                  key={urn}
                  urn={urn}
                  label={mention?.label || extractFallbackLabel(urn)}
                />
              );
            })}
          </div>
        </TaskSection>
      )}

      <TaskSection
        title="Comments"
        open={open.comments}
        onToggle={() => toggle("comments")}
        testId="task-section-comments"
      >
        {/* Grows with its thread so the host stays the only scroller. */}
        <div className="rounded-md border border-border [&>div]:h-auto">
          <CommentsPanel contentType={ContentType.TASK} contentId={task.id} />
        </div>
      </TaskSection>

      <TaskSection
        title="Activity"
        open={open.activity}
        onToggle={() => toggle("activity")}
        testId="task-section-activity"
        actions={<ActivityFilterSelect value={activityFilter} onChange={setActivityFilter} />}
      >
        <ActivityLog taskId={task.id} maxInitialItems={5} filter={activityFilter} />
      </TaskSection>
    </>
  );

  const main = (
    <div className="min-w-0 flex-1 space-y-5" data-testid="task-detail-main">
      <EditableTitle
        title={task.title}
        readOnly={!canEdit}
        onSave={(title) => {
          dispatch(optimisticUpdateTask({ id: task.id, title }));
          void dispatch(updateTask({ id: task.id, title }));
        }}
      />

      <TaskPinnedFields
        task={task}
        project={project}
        allProjectTasks={allProjectTasks}
        sprints={sprints}
        canEdit={canEdit}
      />

      <div data-testid="task-description" className="[&_.expandable-editor-preview]:min-h-24">
        <ExpandableEditor
          key={task.id}
          contentType={ContentType.TASK}
          contentId={task.id}
          value={task.description}
          realtime
          editingPresentation="inline"
          onDone={onDescriptionDone}
          placeholder="Click to add a description... (type @ to mention)"
          label="Description"
          enableUpload
          fullPreview
          showHeader
          readonly={!canEdit}
          expandReadonly
          tone={mode === "sidebar" ? "background" : "surface"}
        />
      </div>

      {!railed && (
        <div className="space-y-1">
          <TaskSection
            title="More fields"
            open={open.fields}
            onToggle={() => toggle("fields")}
            testId="task-section-fields"
          >
            {moreFields}
          </TaskSection>
          {sections}
        </div>
      )}
    </div>
  );

  if (!railed) {
    return (
      <ScrollArea
        className={cn("h-full", mode === "page" && "bg-surface")}
        data-testid="task-detail-scroll"
      >
        <div className={cn("p-4", mode === "page" && "mx-auto max-w-3xl md:p-6")}>{main}</div>
      </ScrollArea>
    );
  }

  // Side by side, each column scrolls on its own and the seam between them drags.
  return (
    <div className="h-full">
      <Group
        orientation="horizontal"
        className="flex h-full"
        defaultLayout={savedRailLayout}
        onLayoutChange={(layout) => savePanelLayout(railLayoutId, layout)}
      >
        <Panel id="task-detail-main" minSize={360}>
          <ScrollArea
            className={cn("h-full", mode === "page" && "bg-surface")}
            data-testid="task-detail-scroll"
          >
            {/* Padding sits inside the scroller so the description toolbar pins to its edge. */}
            <div className={cn("p-4", mode === "page" && "md:p-6")}>{main}</div>
          </ScrollArea>
        </Panel>
        <PaneSeparator />
        <Panel
          id="task-detail-rail"
          defaultSize={mode === "page" ? 352 : 304}
          minSize={240}
          maxSize={640}
        >
          <ScrollArea
            className={cn("h-full space-y-1 p-4", mode === "page" && "md:p-6")}
            data-testid="task-detail-rail"
          >
            <TaskSection
              title="More fields"
              open={open.fields}
              onToggle={() => toggle("fields")}
              testId="task-section-fields"
              className="border-t-0 pt-0"
            >
              {moreFields}
            </TaskSection>
            {sections}
          </ScrollArea>
        </Panel>
      </Group>
    </div>
  );
}
