# Projects Domain - Backlog

> Structured task list for PRD and plan generation.
> Reference: `docs/specs/projects-competitive-analysis.md`

---

## 1. Project Settings Page

- [ ] Create route `/projects/:projectId/settings` with tabbed layout
- [ ] Add gear icon in ProjectHeader to navigate to settings
- [ ] Replace "Edit" in sidebar context menu with "Settings" link
- [ ] Breadcrumb navigation: Projects > Project Name > Settings

### 1.1 General Tab
- [ ] Project name editing
- [ ] Description editing
- [ ] Icon picker
- [ ] Color picker
- [ ] Slug editing with uniqueness validation
- [ ] Visibility scope selector (Private/Organization)
- [ ] Default view selector

### 1.2 Members Tab
- [ ] Member list with roles
- [ ] Add members via SubjectPicker
- [ ] Remove members
- [ ] Bulk invite

### 1.3 Statuses Tab
- [ ] Full status list with color dots and labels
- [ ] Add new status (name + color)
- [ ] Edit status name and color inline
- [ ] Drag-to-reorder statuses
- [ ] Delete status with migration target (reassign tasks using it)
- [ ] Mark status as "done" category for completion tracking
- [ ] Remove ManageStatusesDialog from board view (link to settings page instead)

### 1.4 Custom Fields Tab
- [ ] Field list showing name, type, required flag, sort order
- [ ] Create field with all 7 types (text, number, single_select, multi_select, date, person, reference)
- [ ] Edit field: rename, change required, update config
- [ ] Drag-to-reorder fields
- [ ] Delete field with confirmation (show affected task count)
- [ ] For select fields: manage options inline (add/edit/delete/reorder/color)
- [ ] Remove CreateFieldDialog from table view "+" button (link to settings page instead, or keep both)

### 1.5 Task Types Tab
- [ ] List of task types with icons
- [ ] Per-type field configuration: shown fields, required fields
- [ ] Add/remove task types
- [ ] Preview of create-task form per type

### 1.6 Danger Zone
- [ ] Archive project (soft delete)
- [ ] Delete project permanently with confirmation
- [ ] Transfer ownership

---

## 2. Dedicated Task Page

- [ ] Create `TaskPage` component at route `/projects/:projectId/tasks/:taskId`
- [ ] Two-column layout: left (title, description, comments, activity), right (fields, relations, subtasks)
- [ ] Breadcrumb: Projects > Project Name > SLUG-123
- [ ] `useDocumentTitle("SLUG-123: Task Title")`
- [ ] Previous/Next task navigation
- [ ] All editing capabilities from current detail panel
- [ ] Full-width comments and activity sections

### 2.1 URL-Driven View Modes
- [ ] No query param = full page (default, canonical, shareable)
- [ ] `?modal=true` = project view with modal overlay
- [ ] `?side=true` = project view with sidebar panel
- [ ] Update ProjectsPage to read query params and choose view mode
- [ ] Remove Redux `detailViewMode` state, drive from URL instead
- [ ] Persist user preference (sidebar vs modal) in localStorage for in-context clicks

### 2.2 Navigation Flow
- [ ] Click task row/card in views = append `?side=true` or `?modal=true` based on preference
- [ ] Click task slug (e.g. PROJ-42) in sidebar/modal header = navigate to full page (drop query param)
- [ ] Search result click = full page
- [ ] Notification click = full page
- [ ] Mobile/tablet = always `?modal=true`
- [ ] Update `TaskRedirectPage` to redirect to full page URL

---

## 3. My Work Page

- [ ] Create route `/my-work`
- [ ] Tasks assigned to me across all projects
- [ ] Group by project, sortable by due date/priority/status
- [ ] Overdue tasks section (highlighted)
- [ ] Due this week section
- [ ] Tasks I'm watching
- [ ] Recently completed tasks
- [ ] Quick filters: by project, status, priority, due date range
- [ ] Backend: add ListUserTasks RPC (cross-project query by assignee)

---

## 4. Assign Existing Tasks as Subtasks

- [ ] Task search/picker in subtask section of detail panel ("Add existing task")
- [ ] Drag-and-drop nesting in table view (drag task onto another)
- [ ] "Parent Task" field in detail panel (editable, clearable)
- [ ] Promote subtask to top-level (remove parent)
- [ ] Validation: prevent circular parent chains
- [ ] Validation: prevent cross-project parent assignment

---

## 5. Labels / Tags System

### 5.1 Backend
- [ ] Label model: id, organization_id, name, color, description
- [ ] Label CRUD operations (org-scoped)
- [ ] Add `label_ids` repeated field to Task proto
- [ ] Label assignment/removal on tasks
- [ ] Search index: include labels
- [ ] Proto: LabelService or extend ProjectsService

### 5.2 Frontend
- [ ] Label management UI (org-level settings or project settings)
- [ ] Label picker in task detail panel
- [ ] Label badges on task cards (board) and rows (table)
- [ ] Label filter in FilterBuilder
- [ ] Group-by-label in table view
- [ ] Label column in table view
- [ ] Bulk assign/remove labels

---

## 6. Bulk Operations

- [ ] Extend BulkUpdateTasks proto: due_date, start_date, task_type, parent_id, field_values, label_ids
- [ ] Bulk move tasks between projects
- [ ] Bulk add/remove blockers
- [ ] Bulk add/remove labels
- [ ] "Select all matching filter" (beyond visible selection)
- [ ] Per-task error reporting in bulk response
- [ ] Transactional bulk updates (all-or-nothing option)
- [ ] Expand selection toolbar UI with all bulk actions

---

## 7. Saved Views / Filters

- [ ] Extend ViewConfig.config_json to include filter criteria
- [ ] Create multiple named views per type (e.g. "My Bugs", "Sprint Review Board")
- [ ] Personal vs shared views (visibility scoping)
- [ ] Save current filter/sort/group as a new view
- [ ] Pin favorite views in sidebar
- [ ] Set default view per project
- [ ] View management in project settings Views tab

---

## 8. Sprint Completion Flow

- [ ] Sprint completion dialog showing incomplete task count
- [ ] Options: move to next planned sprint, move to backlog, move to specific sprint
- [ ] Summary: what was completed vs carried over
- [ ] Update CompleteSprint RPC to accept target for incomplete tasks

---

## 9. Activity Log Improvements

- [ ] Track title changes
- [ ] Track description changes
- [ ] Track custom field value changes
- [ ] Track due date / start date changes
- [ ] Track parent task changes
- [ ] Track blocker additions/removals
- [ ] Track label changes
- [ ] Show old/new values for all changes
- [ ] Filter activity by action type
- [ ] Filter activity by actor

---

## 10. Dependency Types

- [ ] Add relationship type enum: blocks, blocked_by, relates_to, duplicates
- [ ] Typed link model replacing flat blocked_by_task_ids
- [ ] "Relates to" as bidirectional lightweight link
- [ ] "Duplicates" with option to close duplicate
- [ ] Show reverse relationships in detail panel
- [ ] Dependency type selector when adding a link
- [ ] Update dependency graph view for new types

---

## 11. Time Tracking

### 11.1 Backend
- [ ] TimeEntry model: id, task_id, user_id, minutes, description, logged_at
- [ ] TimeEntry CRUD operations
- [ ] Aggregation: per task, per sprint, per project, per user
- [ ] Auto-update task time_spent_minutes from entries

### 11.2 Frontend
- [ ] Time entry list in task detail
- [ ] Add time entry form (duration + description + date)
- [ ] Start/stop timer button in task detail header
- [ ] Timer state persistence (survives page refresh)
- [ ] Time summary per sprint in backlog view
- [ ] Time summary per user in resource view

---

## 12. Sprint Analytics

- [ ] Daily sprint snapshot model (total tasks, completed, estimated hours)
- [ ] Burndown chart component (ideal line vs actual)
- [ ] Velocity chart (completed per sprint over time)
- [ ] Sprint report on completion (done, carried over, added mid-sprint)
- [ ] Sprint analytics tab or section in backlog view

---

## 13. Project Templates

- [ ] Built-in templates: Scrum, Kanban, Bug Tracking, Feature Development
- [ ] Template includes: statuses, task types, custom fields, views
- [ ] Template selector in CreateProjectModal
- [ ] Save existing project as template
- [ ] Template management UI (org-level)

---

## 14. Task Templates

- [ ] Task template model: project-scoped, pre-filled fields + subtask checklist
- [ ] Template selector in CreateTaskModal
- [ ] "Save as template" from existing task detail
- [ ] Template management in project settings

---

## 15. Command Palette

- [ ] Ctrl+K global shortcut
- [ ] Quick actions: create task, switch project, change view
- [ ] Search tasks by title or number
- [ ] Jump to specific task (type PROJ-42)
- [ ] Recent items
- [ ] Keyboard navigation (arrow keys, Enter)

---

## 16. Task Detail Panel Improvements

- [ ] Group fields into sections: Core, Schedule, Relations
- [ ] Collapsible sections with headers
- [ ] Quick-action buttons at top (Change Status, Assign, Set Due Date)
- [ ] Wider default sidebar panel
- [ ] Persist sidebar/modal preference to localStorage

---

## 17. Quick Task Entry

- [ ] Inline "quick add" row at bottom of table view
- [ ] Quick-add input at bottom of board columns
- [ ] Quick-add in backlog sprint sections
- [ ] Smart text parsing: "Fix bug #p:high @john due:friday"

---

## 18. Board View Improvements

- [ ] Configurable card fields per view (choose which fields show)
- [ ] Compact vs detailed card mode toggle
- [ ] Custom field values on cards (when configured)

---

## 19. Roadmap View Improvements

- [ ] Click empty timeline space to create task with pre-filled dates
- [ ] Drag to create date range for new tasks
- [ ] Snap-to-grid date alignment
- [ ] Toggle dependency lines on/off
- [ ] Milestone markers (diamond shapes)
- [ ] Sprint boundary markers (vertical lines)
- [ ] Zoom presets: This Sprint, This Month, This Quarter

---

## 20. Backlog View Improvements

- [ ] Sprint capacity summary (estimated hours vs team capacity)
- [ ] Drag tasks between sprint cards
- [ ] Estimation totals per sprint
- [ ] "Plan Sprint" mode: side-by-side backlog + target sprint
- [ ] Sprint scope visualization (in scope vs at risk)

---

## 21. Table View Improvements

- [ ] Editable cell visual hints (pencil icon on hover)
- [ ] Compact/comfortable/spacious row density toggle
- [ ] Column visibility popover (show/hide columns)
- [ ] Visible column resize handles

---

## 22. Portfolio Page Improvements

- [ ] Portfolio timeline (all projects on a single gantt)
- [ ] Resource allocation view across projects
- [ ] Priority heatmap (urgent/overdue per project)
- [ ] Portfolio-level filtering and sorting
- [ ] Drill-down from card to project

---

## 23. Empty State Improvements

- [ ] First-project onboarding: "Create your first task" with example
- [ ] Empty board: column structure with "Drag tasks here"
- [ ] Empty backlog: "Create a sprint to start planning"
- [ ] Empty roadmap: "Add start and due dates to see tasks on the timeline"

---

## 24. Keyboard Shortcut Discoverability

- [ ] Shortcut hints in button tooltips
- [ ] Context-aware shortcut bar at bottom of table view

---

## 25. Automation Rules

- [ ] Rule model: trigger + condition + action
- [ ] Rule builder UI
- [ ] Triggers: status change, task created, field changed, time-based
- [ ] Actions: set field, assign, notify, move to sprint, add label
- [ ] Rule management in project settings

---

## 26. AI Features

- [ ] "Suggest subtask breakdown" from task description
- [ ] "Draft task description" from title
- [ ] Sprint planning assistant (suggest backlog items based on velocity)
- [ ] Sprint summary generation from activity log

---

## 27. Import / Export

- [ ] Import from Jira (CSV)
- [ ] Import from Linear
- [ ] Import from Asana / Trello
- [ ] Export to CSV / Excel
- [ ] Project backup / restore

---

## 28. Epics as First-Class Entities

- [ ] Epic-level progress tracking across projects
- [ ] Epic timeline in roadmap
- [ ] Epic board (epics as columns, tasks as cards)

---

## 29. Goals / OKR

- [ ] Goal model (org or project level)
- [ ] Link tasks/projects to goals
- [ ] Goal progress tracking from linked task completion

---

## 30. Task Intake Forms

- [ ] Form builder using existing field definitions
- [ ] Public or internal forms that create tasks
- [ ] Embed forms externally

---

## 31. Dashboard Widgets

- [ ] Sprint burndown widget
- [ ] My tasks widget (overdue, due today, due this week)
- [ ] Team velocity widget
- [ ] Project progress donut chart

---

## 32. SLA Policies

- [ ] SLA rules per priority (response time, resolution time)
- [ ] SLA countdown in task detail
- [ ] SLA breach notifications
- [ ] SLA compliance reporting
