# Projects Domain - Competitive Analysis & Improvement Plan

> Analysis date: 2026-04-04
> Compared against: Jira, Linear, Asana, Microsoft Planner, ClickUp, Monday.com

---

## 1. Current State Summary

Uniffy's projects domain is a **solid foundation** with more depth than expected. The backend is mature with 29 RPC methods, sophisticated automation (parent auto-completion, recurring task spawning, circular dependency prevention), and a full sprint management system. The frontend has 6 view types (Table, Board, Roadmap, Backlog, Dependency Graph, Resources) with inline editing, drag-and-drop, keyboard navigation, and multi-selection.

### What exists today

| Area | Status | Notes |
|------|--------|-------|
| Project CRUD | Complete | Icon, color, slug, visibility, members |
| Task CRUD | Complete | 31 fields, auto-incrementing numbers |
| Subtasks | Complete | 5-level nesting, parent auto-complete/reopen |
| Statuses | Complete | Configurable per project, color-coded |
| Priorities | Complete | 4 levels (Low/Medium/High/Urgent) |
| Task Types | Complete | Task/Bug/Feature/Story/Epic with per-type field schemas |
| Custom Fields | Complete | 7 types (text, number, select, multi-select, date, person, reference) |
| Sprints | Complete | Create/start/complete/delete, single active constraint |
| Dependencies | Partial | blocked_by only, circular prevention, status enforcement |
| Recurrence | Complete | Daily/weekly/monthly/yearly, auto-spawn on completion |
| Time Tracking | Basic | estimated_minutes + time_spent_minutes fields only |
| Comments | Complete | Threading, reactions, resolution, anchoring |
| Activity Log | Partial | Tracks 6 action types, misses custom fields + description |
| Notifications | Partial | Assignment, due soon, overdue |
| Watchers | Complete | Toggle, bulk check, notifications on changes |
| Search | Complete | Full-text search for tasks and projects |
| Bookmarks | Complete | Via shared bookmarks system |
| Attachments | Complete | Via shared attachments system |
| Views - Table | Complete | Inline editing, grouping, sorting, column config, keyboard nav |
| Views - Board | Complete | Kanban with drag-and-drop, status management |
| Views - Roadmap | Complete | Gantt bars with resize, dependency lines, zoom |
| Views - Backlog | Complete | Sprint cards, task assignment, progress |
| Views - Graph | Complete | Interactive dependency visualization with critical path |
| Views - Resources | Complete | Workload per assignee with time tracking |
| Portfolio | Basic | Project cards with health badges |
| Bulk Operations | Basic | Status, priority, assignee, sprint, delete |
| Filtering | Basic | Search + FilterBuilder + sprint/type quick filters |
| Permissions | Complete | 3-layer system, project-level scoping |

---

## 2. Critical Gaps (Must-Have for Competition)

These are features that every serious competitor has and users will immediately notice are missing.

### 2.1 No "My Work" / "My Tasks" view

**Gap**: There is no cross-project aggregation of a user's tasks. Users cannot see "all tasks assigned to me across all projects" in a single view. The dashboard shows counts but not actionable task lists.

**What competitors do**:
- Jira: "Your Work" page with assigned/watched/recent items
- Linear: "My Issues" with filters
- Asana: "My Tasks" with sections (Today/Upcoming/Later)
- ClickUp: "My Work" hub

**Impact**: High. This is the first thing users look for every morning.

**Action**: Create a dedicated `/my-work` page showing:
- Tasks assigned to me (grouped by project, sortable by due date)
- Tasks I'm watching
- Recently completed tasks
- Overdue tasks (highlighted)
- Quick filters (by project, status, priority, due date range)
- This should also be the default home for project-heavy users

### 2.2 Cannot assign existing tasks as subtasks

**Gap**: The backend supports updating `parent_id` on any task, but the UI only allows **creating new subtasks** from the detail panel. There is no way to pick an existing task and make it a child of another task.

**What competitors do**:
- Jira: "Link issue" dialog with "is child of" relationship
- Linear: Sub-issue picker or drag-and-drop in list
- Asana: "Tab+P" to add parent, or drag into another task

**Impact**: High. Users create tasks at the wrong level constantly and need to reorganize.

**Action**:
- Add a task search/picker in the subtask section ("Add existing task as subtask")
- Allow drag-and-drop nesting in table view (drag task onto another task)
- Allow changing parent via a "Parent Task" field in detail panel
- Allow removing parent (promoting subtask to top-level)

### 2.3 No bulk management beyond basics

**Gap**: Bulk operations only support changing status, priority, assignees, sprint, and delete. Missing: bulk set due dates, bulk change type, bulk set custom fields, bulk move to project, bulk add/remove blockers.

**What competitors do**:
- Jira: Bulk change any field, bulk transition, bulk move between projects
- Linear: Multi-select and change any property
- Asana: Multi-select with full field editing
- ClickUp: Bulk everything including custom fields

**Impact**: High. Users managing 50+ tasks need efficient bulk operations.

**Action**:
- Extend BulkUpdateTasks proto to support: due_date, start_date, task_type, parent_id, field_values
- Add bulk move between projects
- Add bulk add/remove blockers
- UI: Expand the selection toolbar with all available bulk actions
- Add "Select all matching filter" for bulk operations beyond visible selection

### 2.4 Labels / Tags system

**Gap**: No label or tag system exists. Users cannot categorize tasks with cross-cutting concerns (e.g., "frontend", "backend", "design-review", "client-X").

**What competitors do**:
- Jira: Labels (free-form) + Components (project-scoped)
- Linear: Labels (workspace-level, colored)
- Asana: Tags (workspace-level)
- GitHub Issues: Labels with colors

**Impact**: High. Labels are fundamental for filtering and organizing work.

**Action**:
- Add a `labels` field to Task (repeated string, referencing Label entities)
- Create Label entity (org-scoped): id, name, color, description
- Label CRUD at org level (shared across projects)
- Label filter in all views
- Label badges on task cards/rows
- Group-by-label in table view

### 2.5 Saved Filters / Saved Views

**Gap**: Filter configurations are ephemeral (stored in Redux, lost on reload). Users cannot save, name, and share filter presets. Views (table/board/roadmap) store column config but not filter criteria.

**What competitors do**:
- Jira: JQL saved filters, shared dashboards, filter subscriptions
- Linear: Custom views with saved filter + sort + grouping, team-shared
- Asana: Saved search, custom sections
- ClickUp: Saved filters per view

**Impact**: High. Power users build complex filters daily and need them persistent.

**Action**:
- Extend ViewConfig to include filter criteria in config_json
- Allow creating multiple named views per type (e.g., "My Bugs", "Sprint Review Board")
- Personal vs shared views (visibility scoping)
- Pin favorite views in sidebar
- Default view per project

### 2.6 Workflow Automation / Rules

**Gap**: No automation system exists. The only automated behaviors are hardcoded: parent auto-completion, blocker enforcement, and recurring task spawning.

**What competitors do**:
- Jira: Automation rules (when X then Y) with 100+ triggers and actions
- Linear: Triage workflows, auto-assign, auto-close stale
- Asana: Rules (trigger + action pairs)
- ClickUp: Automations builder

**Impact**: Medium-High. Automation saves significant time for teams.

**Action** (phased):
- Phase 1: Simple rules engine (when status changes to Done, then notify watchers - already done; when task created with type Bug, auto-assign to person X)
- Phase 2: Rule builder UI with trigger/condition/action model
- Phase 3: Time-based triggers (auto-close stale tasks, reminder escalation)

---

## 3. Important Gaps (Expected by Power Users)

### 3.1 Dependency types are limited

**Current**: Only "blocked by" exists. No typed relationships.

**What competitors do**:
- Jira: blocks, is blocked by, relates to, duplicates, is duplicated by, clones, is cloned by
- Linear: blocks/blocked by, relates to, duplicates
- Asana: blocked by, blocking, duplicate of

**Action**:
- Add relationship types: `blocks`, `relates_to`, `duplicates`
- "Relates to" is bidirectional, lightweight
- "Duplicates" should allow closing duplicate with reference
- Show reverse relationships in detail panel (currently only forward "blocks" shown)

### 3.2 No time tracking log (only totals)

**Current**: `estimated_minutes` and `time_spent_minutes` are flat integers. No way to log individual time entries.

**What competitors do**:
- Jira: Work log entries with date, duration, description
- ClickUp: Time tracking with start/stop timer, manual entries, reports
- Toggl/Harvest integrations

**Action**:
- Add TimeEntry model: task_id, user_id, minutes, description, logged_at
- Time entry CRUD
- Timer start/stop UI in task detail
- Aggregation: per task, per sprint, per project, per user
- Timesheet view (resource view with time breakdown)

### 3.3 Sprint velocity and burndown

**Current**: Sprint has task_count and completed_task_count. No historical data, no velocity calculation, no burndown chart.

**What competitors do**:
- Jira: Burndown chart, velocity chart, sprint report
- Linear: Cycle analytics
- Azure DevOps: Burndown, velocity, cumulative flow

**Action**:
- Track daily sprint snapshots (total tasks, completed, points)
- Burndown chart component (ideal line vs actual)
- Velocity chart (completed per sprint over time)
- Sprint report on completion (what was done, what carried over, what was added mid-sprint)

### 3.4 Incomplete sprint completion flow

**Current**: Completing a sprint just sets status to "closed". Incomplete tasks stay in the closed sprint with no user prompt.

**What competitors do**:
- Jira: On sprint complete, dialog asks where to move incomplete items (next sprint, backlog, specific sprint)
- Linear: Auto-moves incomplete to next cycle or backlog

**Action**:
- Sprint completion dialog that shows incomplete tasks
- Options: move to next planned sprint, move to backlog, move to specific sprint
- Summary of what was completed vs carried over

### 3.5 No project templates

**Current**: Every project starts from scratch. No way to create from template.

**What competitors do**:
- Jira: Project templates (Scrum, Kanban, Bug tracking)
- Asana: 100+ templates
- Monday: Templates gallery

**Action**:
- Define built-in templates: Scrum, Kanban, Bug Tracking, Feature Development
- Template includes: default statuses, task types, custom fields, views, sprint structure
- Allow saving existing project as template
- Template selection in CreateProjectModal

### 3.6 No task templates / quick-create presets

**Current**: Every task is created from scratch. No templates for common task patterns.

**What competitors do**:
- Jira: Issue templates (per project, per type)
- Linear: Issue templates
- ClickUp: Task templates

**Action**:
- Task templates per project (pre-filled title pattern, description, fields, subtask checklist)
- Template selector in CreateTaskModal
- "Save as template" from existing task

### 3.7 Activity log gaps

**Current**: Tracks: created, status_changed, priority_changed, assigned, type_changed, sprint_changed. Does NOT track: title changes, description changes, custom field changes, due date changes, parent changes, blocker changes.

**Action**:
- Log all field changes (title, description, dates, custom fields, parent, blockers)
- Show old/new values for all changes
- Filter activity by action type or actor

### 3.8 No SLA / Due Date policies

**Current**: Due dates exist but no enforcement policies, no SLA tracking.

**What competitors do**:
- Jira: SLA goals per priority level
- ServiceNow: Full SLA management

**Action** (lower priority):
- Define SLA rules per priority (e.g., Urgent = 4h response, 24h resolution)
- SLA countdown in task detail
- SLA breach notifications
- SLA compliance reporting

---

## 4. UI/UX Problems

### 4.1 The project page feels like a data viewer, not a work tool

**Problem**: The UI presents data but doesn't guide users toward action. When you open a project, you see tasks but nothing tells you "these 3 things need your attention right now."

**What competitors do**:
- Linear: Clean, focused UI with keyboard-first navigation. The inbox shows what matters.
- Asana: "My Tasks" with Today/Upcoming/Later sections create urgency
- Jira: Sprint board front-and-center shows active work

**Actions**:
- Add an "Attention needed" indicator at the top of project views showing: overdue tasks, unblocked tasks ready to start, tasks due this week
- Default the board view to active sprint (already partially done)
- Add a "Focus mode" that shows only tasks assigned to you in the current sprint
- Show project health summary at the top (not just in portfolio)

### 4.2 No dedicated task page + broken detail view architecture

**Problem**: Tasks can only be viewed in a sidebar panel or modal overlay. There is no dedicated full-page task view. Every serious competitor (Jira, Linear, Asana, ClickUp) has a full-page issue view as the canonical way to work on a task. Additionally, the sidebar detail panel crams too much into a narrow space, fields are displayed as a flat list without logical grouping, and the current URL scheme doesn't distinguish between view modes.

**Current state**:
- Two modes: sidebar (inline right panel) and modal (centered overlay)
- Toggle stored in Redux only (not persisted, resets to "sidebar" on refresh)
- URL: `/projects/:projectId/tasks/:taskId` for both modes (no distinction)
- Mobile/tablet always forces modal
- `TaskRedirectPage` at `/projects/task/:taskId` resolves project then redirects
- No way to share a link that opens in a specific mode

**How competitors handle this**:

| Tool | In-context (from board/list) | Deep dive / direct link |
|------|-----|-----|
| Jira | Modal overlay | Full page (click issue key) |
| Linear | Sidebar panel | Full page (Enter key or click title) |
| Asana | Sidebar panel | Full page (expand button) |
| ClickUp | Sidebar panel | Full page (expand button) |

**Design: URL-driven view mode with dedicated task page**

The solution is three tiers of task detail, driven by URL - not a 3-way toggle:

| View mode | URL | When used |
|-----------|-----|-----------|
| Full page | `/projects/:projectId/tasks/:taskId` | Default. Direct links, search results, notifications, click on task slug |
| Modal | `/projects/:projectId/tasks/:taskId?modal=true` | Click task from board/table/backlog (if user prefers modal) |
| Sidebar | `/projects/:projectId/tasks/:taskId?side=true` | Click task from board/table/backlog (if user prefers sidebar) |

**Navigation flow**:
1. User clicks a task row/card in board, table, or backlog - opens sidebar or modal based on their preference, URL gets `?side=true` or `?modal=true`
2. User clicks the **task slug** (e.g., `PROJ-42`) in the sidebar or modal header - navigates to the full page (drops the query param). This is the "go deeper" action
3. Opening from search, notification, shared link, or direct URL (no query param) - always full page
4. Mobile/tablet always uses `?modal=true` behavior regardless

**The sidebar/modal toggle stays as a 2-option preference** (for in-context viewing). The full page is not a toggle - it's a separate navigation depth, accessed by clicking the task slug or visiting the canonical URL.

**Full page task view (new `TaskPage` component)**:
- Proper page layout with full width, no project board/table behind it
- Breadcrumb: `Projects > Project Name > PROJ-42`
- Two-column layout: left = title, description, comments, activity; right = fields, relations, subtasks
- All editing capabilities from current detail panel
- Comments and activity get proper room
- Previous/Next task navigation
- Uses `useDocumentTitle("PROJ-42: Task Title")`

**Detail panel improvements (sidebar and modal)**:
- Group fields into sections: "Core" (status, priority, type, assignees), "Schedule" (dates, sprint, recurrence, time tracking), "Relations" (parent, blockers, references)
- Add collapsible sections with section headers
- Make the detail panel wider by default (or auto-expand when there's room)
- Add quick-action buttons at the top (Change Status, Assign, Set Due Date) - not buried in field list
- Persist view mode preference to localStorage (currently lost on refresh)

**URL behavior details**:
- Sidebar/modal query params are ephemeral - they reflect "I'm peeking at this task from the project view"
- The canonical URL (no query param) is the shareable, bookmarkable link
- Browser back from full page returns to the project view
- Browser back from sidebar/modal closes the detail and returns to the base project URL

### 4.3 No dedicated project settings page - configuration is scattered

**Problem**: The entire project configuration lives in a single EditProjectModal and scattered view-specific popovers. Custom field creation is hidden behind a "+" button only visible in table view. Status management is a popover only accessible from board view. There is no central place to configure a project. Every competitor has a dedicated project settings area.

**Current state**:

| Setting | Where it lives | Problem |
|---------|---------------|---------|
| Name, description, icon, visibility | EditProjectModal (from sidebar context menu) | Buried in context menu, modal is basic |
| Status management | ManageStatusesDialog (board view header only) | Invisible if you're on table/roadmap/backlog |
| Custom field creation | CreateFieldDialog popover (table view "+" column) | Only accessible from table view |
| Custom field editing | No UI | Can delete but can't rename, reorder, or change options |
| Custom field reordering | No UI | sort_order exists in backend but no drag-to-reorder |
| Task type field schemas | TypeFieldSchemasSection (inside EditProjectModal) | Buried inside a modal, hard to find |
| Project members | No real UI | Just a member_ids array on UpdateProject, no member management |
| Saved views | No UI | Backend supports view CRUD but no management interface |
| Default view | No UI | Backend supports default_view_id but no way to set it |
| Archive/delete | Delete button in sidebar context menu | No confirmation of consequences, no archive option |

**What competitors do**:
- Jira: Full project settings area with sections for details, access, notifications, features, issue types, fields, workflows, screens, permissions
- Linear: Team settings with labels, workflows, members, integrations
- Asana: Project settings with fields, rules, forms, status updates
- ClickUp: Space settings with statuses, custom fields, integrations, automations

**Action: Create a dedicated project settings page**

**Route**: `/projects/:projectId/settings` with tabbed sub-sections, accessible from a gear icon in the project header and from the sidebar context menu.

**Sections**:

**General**
- Project name, description, icon picker, color picker
- Slug (editable, with uniqueness validation)
- Visibility scope (Private/Organization)
- Default view selector
- Replace the current EditProjectModal for these settings

**Members**
- Member list with roles (viewer/editor/admin)
- Add/remove members via SubjectPicker
- Bulk invite
- Show who has access via visibility/group inheritance

**Statuses**
- Full status list with color dots and labels
- Add new status with name + color picker
- Edit existing status name and color inline
- Drag-to-reorder statuses (affects board column order and select dropdown order)
- Delete status with confirmation (show count of tasks using it, require migration target)
- Mark one status as "done" category (for completion tracking)
- Currently this is only in ManageStatusesDialog on board view - move it here as the canonical location

**Custom Fields**
- Full field list showing: name, type, required flag, sort order
- Create new field with all 7 types (text, number, single_select, multi_select, date, person, reference)
- Edit field: rename, change required flag, update options (for select types), change config
- Drag-to-reorder fields (controls display order in all views)
- Delete field with confirmation (show count of tasks with values, warn about data loss)
- For select fields: manage options (add/edit/delete/reorder/color) inline
- For person fields: configure whether multi-select is allowed
- Currently field creation is only possible from table view "+" button - this page becomes the central place

**Task Types**
- List of task types with icons
- Per-type configuration: which custom fields are shown, which are required
- Add/remove task types
- Currently buried in TypeFieldSchemasSection inside EditProjectModal - promote to full section
- Preview of what the create task form looks like per type

**Views** (future, after saved views feature)
- List of saved views with name, type, creator
- Set default view
- Delete views
- Share/unshare views

**Danger Zone**
- Archive project (soft delete, recoverable)
- Delete project permanently (with confirmation, show task count)
- Transfer ownership

**Navigation**:
- Gear icon in ProjectHeader (next to the view mode toggle)
- "Settings" option in sidebar context menu (replace "Edit" which opens the modal)
- Breadcrumb: `Projects > Project Name > Settings`
- Back button returns to the project view

**Responsive behavior**:
- Desktop: full page with sidebar tabs for sections
- Tablet: same layout, narrower
- Mobile: sections as a vertical list or accordion

### 4.4 Table view is powerful but overwhelming

**Problem**: TableView.tsx is 1,008 lines and the most complex component. While feature-rich, new users won't discover inline editing, keyboard navigation, or grouping without guidance.

**Actions**:
- Add subtle visual hints for editable cells (light pencil icon on hover)
- Show a brief onboarding tooltip on first use ("Double-click to edit, arrow keys to navigate")
- Add column resize handles that are more visible
- Consider a compact/comfortable/spacious row density toggle
- Add a "Columns" settings popover to show/hide columns (currently requires Add Column dialog)

### 4.5 Board view cards show too much or too little

**Problem**: Board cards try to show everything (dates, priority, blockers, subtasks, time, references, assignees) which makes them visually noisy. But they don't show custom field values which may be the most important info.

**Actions**:
- Allow configuring which fields appear on board cards (per view config)
- Default to: title, status bar, priority badge, assignee avatars, due date if set
- Show custom fields only when configured
- Add a compact card mode (title + status + assignee only) vs detailed mode

### 4.6 Roadmap view needs polish

**Problem**: The roadmap/gantt view is functional but feels like a visualization rather than a planning tool. You can resize bars but can't create tasks directly, can't drag to create date ranges, and dependency lines can get cluttered.

**Actions**:
- Click on empty timeline space to create a task with pre-filled dates
- Drag to create a date range for new tasks
- Snap-to-grid for date alignment
- Toggle dependency lines on/off
- Milestone markers (diamond shapes on timeline)
- Sprint boundary markers (vertical lines showing sprint start/end)
- Zoom presets that make sense (This Sprint, This Month, This Quarter)

### 4.7 Backlog view lacks planning tools

**Problem**: The backlog view shows sprints and tasks but doesn't help with sprint planning. No capacity indicators, no drag between sprints, no estimation summaries.

**Actions**:
- Show sprint capacity summary (total estimated hours vs team capacity)
- Drag tasks between sprint cards
- Show estimation totals per sprint
- "Plan Sprint" mode: side-by-side backlog and target sprint with drag-to-add
- Sprint scope visualization (what's in scope vs at risk based on estimates)

### 4.8 No keyboard shortcut discoverability

**Problem**: The system supports keyboard shortcuts but users won't know about them. No shortcut hints on buttons, no command palette.

**Actions**:
- Show shortcut hints in tooltips (e.g., hover over "New Task" shows "Ctrl+N")
- Add a command palette (Ctrl+K) for quick actions: create task, switch project, change view, search tasks, jump to specific task by number
- Context-aware shortcuts in table view (shown in a small bar at the bottom)

### 4.9 Empty states don't guide action

**Problem**: Empty states show generic messages. A new project with no tasks says "No tasks" but doesn't guide users to create their first task or import from another tool.

**Actions**:
- First-project onboarding: "Create your first task" with pre-filled example
- Empty board: Show column structure with "Drag tasks here" per column
- Empty backlog: "Create a sprint to start planning"
- Empty roadmap: "Add start and due dates to see tasks on the timeline"
- Import option: "Import from CSV/Jira" (future)

### 4.10 No quick task entry

**Problem**: Creating a task requires opening a modal with many fields. For rapid entry, users want to type a title and press Enter.

**Actions**:
- Add inline "quick add" row at the bottom of table view (type title, press Enter)
- Add quick-add at the bottom of board columns (already partially exists)
- Add quick-add in backlog sprint sections
- Support parsing: "Fix login bug #p:high @john due:friday" - parse priority, assignee, due date from text

### 4.11 Portfolio page is too basic

**Problem**: The portfolio page shows project cards with health badges but provides no actionable intelligence. No comparisons, no timelines, no resource allocation across projects.

**Actions**:
- Add a portfolio timeline (all projects on a single gantt)
- Resource allocation view: which team members are over/under-allocated across projects
- Priority heatmap: which projects have the most urgent/overdue tasks
- Allow portfolio-level filtering and sorting
- Drill-down from portfolio card to project

---

## 5. Nice-to-Have (Differentiation Opportunities)

### 5.1 AI-powered features (leverage existing agents)

Uniffy already has an AI agent system. The projects domain can leverage it:
- "Suggest subtask breakdown" - AI analyzes a task description and suggests subtasks
- "Draft task description" - from title, generate a structured description
- "Sprint planning assistant" - suggest which backlog items to include based on velocity and priority
- "Summarize sprint" - generate a sprint review summary from activity log

### 5.2 Import/Export

- Import from Jira (CSV, API)
- Import from Linear, Asana, Trello
- Export to CSV/Excel
- Project backup/restore

### 5.3 Epics as first-class entities

Currently "epic" is just a task_type string. Epics could be elevated:
- Epic-level progress tracking across projects
- Epic timeline in roadmap
- Epic board (epics as columns, tasks as cards)

### 5.4 Goals / OKR alignment

- Define goals at org or project level
- Link tasks/projects to goals
- Goal progress tracking based on linked task completion

### 5.5 Forms for task intake

- Public or internal forms that create tasks
- Custom form builder using existing field definitions
- Embed forms in other tools

### 5.6 Dashboard widgets for projects

- Sprint burndown widget
- My tasks widget (overdue, due today, due this week)
- Team velocity widget
- Project progress donut chart

---

## 6. Prioritized Action Plan

### Phase 1 - Close Critical Gaps (Foundation)

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 1 | "My Work" page - cross-project task aggregation | Critical | Medium |
| 2 | Assign existing tasks as subtasks (picker + drag-and-drop) | Critical | Small |
| 3 | Labels/Tags system (model + CRUD + UI + filtering) | Critical | Medium |
| 4 | Extend bulk operations (all fields + cross-project move) | Critical | Medium |
| 5 | Saved filters in views (persist filter config) | Critical | Medium |
| 6 | Sprint completion dialog with task movement options | High | Small |
| 7 | Full activity log (track all field changes) | High | Small |
| 8 | Dedicated task page + URL-driven view modes (?modal, ?side, default=page) | Critical | Medium |
| 9 | Project settings page (statuses, custom fields, types, members) | Critical | Medium |

### Phase 2 - Power User Features

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 10 | Dependency types (relates_to, duplicates) | High | Medium |
| 11 | Time tracking log (entries + timer + aggregation) | High | Medium |
| 12 | Sprint burndown and velocity charts | High | Medium |
| 13 | Project templates (built-in + save-as-template) | Medium | Medium |
| 14 | Task templates | Medium | Small |
| 15 | Command palette (Ctrl+K) | Medium | Medium |

### Phase 3 - UI/UX Refinement

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 16 | Task detail panel restructure (grouped sections, quick actions) | High | Medium |
| 17 | Board card configurability (choose which fields show) | Medium | Small |
| 18 | Quick task entry (inline add row with text parsing) | High | Medium |
| 19 | Backlog planning tools (capacity, drag between sprints) | High | Medium |
| 20 | Roadmap enhancements (click-to-create, milestones, sprint markers) | Medium | Medium |
| 21 | Table density toggle and column visibility popover | Medium | Small |
| 22 | Empty state improvements with guided actions | Medium | Small |
| 23 | Portfolio page enhancements (timeline, resource allocation) | Medium | Large |

### Phase 4 - Automation & Intelligence

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 24 | Rule-based automation engine (trigger/condition/action) | High | Large |
| 25 | AI task breakdown suggestions (via existing agents) | Medium | Medium |
| 26 | AI sprint planning assistant | Medium | Medium |
| 27 | Import from Jira/Linear/CSV | High | Large |

### Phase 5 - Differentiation

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 28 | Epics as first-class entities with cross-project tracking | Medium | Large |
| 29 | Goals/OKR system with task alignment | Medium | Large |
| 30 | Task intake forms (public/internal) | Medium | Medium |
| 31 | Dashboard widgets (burndown, my tasks, velocity) | Medium | Medium |
| 32 | SLA policies and tracking | Low | Medium |

---

## 7. Feature Comparison Matrix

| Feature | Uniffy | Jira | Linear | Asana | Planner |
|---------|--------|------|--------|-------|---------|
| Task detail view | Sidebar + Modal only, **no full page** | Modal + Full page | Sidebar + Full page | Sidebar + Full page | Full page only |
| Task CRUD | Yes | Yes | Yes | Yes | Yes |
| Subtasks | Yes (5 levels) | Yes | Yes (unlimited) | Yes (1 level) | Yes (1 level) |
| Assign existing as subtask | Backend only, no UI | Yes | Yes | Yes | No |
| Custom fields | Yes (7 types) | Yes (10+ types) | No (fixed fields) | Yes (7 types) | No |
| Labels/Tags | **No** | Yes | Yes | Yes | Yes |
| Sprints/Cycles | Yes | Yes | Yes (Cycles) | No (Sections) | No |
| Sprint completion flow | Basic (no task movement) | Full (move dialog) | Full (auto-move) | N/A | N/A |
| Sprint burndown | **No** | Yes | Yes | N/A | N/A |
| Velocity tracking | **No** | Yes | Yes | N/A | N/A |
| Board view | Yes | Yes | Yes | Yes | Yes |
| Table view | Yes (advanced) | Yes | Yes | Yes | No |
| Roadmap/Gantt | Yes | Yes (Premium) | Yes | Yes (Premium) | No |
| Dependency graph | Yes (unique!) | No (plugin) | No | No | No |
| Resource view | Yes | No (plugin) | No | Yes (Premium) | No |
| Dependencies | blocked_by only | 6 types | 2 types | 2 types | No |
| Time tracking | Basic (totals) | Yes (work log) | No | No | No |
| Comments | Yes (threaded) | Yes | Yes | Yes | Yes |
| Reactions | Yes | Yes | Yes | Yes | Yes |
| Watchers | Yes | Yes | Yes (subscribers) | Yes (followers) | No |
| Activity log | Partial (6 actions) | Full | Full | Full | Basic |
| Notifications | Partial | Full | Full | Full | Basic |
| My Work / My Tasks | **No** | Yes | Yes | Yes | Yes |
| Saved views/filters | **No** | Yes | Yes | Yes | No |
| Automation rules | **No** | Yes (100+ actions) | Yes | Yes | No |
| Templates | **No** | Yes | Yes | Yes | Yes |
| Import/Export | **No** | Yes | Yes | Yes (CSV) | No |
| Bulk operations | Basic (4 fields) | Full | Full | Full | Basic |
| Command palette | **No** | No | Yes | Yes | No |
| AI features | Via agents (general) | Atlassian Intelligence | No | Asana AI | Copilot |
| Real-time collab | Notifications only | Yes | Yes | Yes | Yes |
| Recurring tasks | Yes | No (plugin) | No | Yes | Yes |
| Milestones | Yes (flag) | No (issue type) | No | Yes | Yes |
| Portfolio view | Basic | Yes (Premium) | Yes (Projects) | Yes (Premium) | No |
| Cross-project search | Yes | Yes | Yes | Yes | No |
| Mobile support | Responsive + native | Native app | Native app | Native app | Native app |
| Permissions | 3-layer + domain admin | Project roles | Workspace roles | Project roles | O365 roles |
| Markdown descriptions | Yes (with mentions) | Wiki markup | Yes | Rich text | No |
| Attachments | Yes (via shared system) | Yes | Yes | Yes | Yes |
| Bookmarks | Yes (via shared system) | No (favorites) | Yes (favorites) | Yes (favorites) | No |

---

## 8. Unique Strengths to Preserve and Emphasize

1. **Dependency Graph View** - No competitor has this built-in. The critical path analysis and interactive node visualization is genuinely unique. Market this.

2. **Resource View** - Team workload visibility built-in, not behind a premium paywall like Asana/Jira.

3. **Universal mentions** - Tasks can reference notes, files, events, users, groups via URN. This cross-domain linking is Uniffy's core value proposition.

4. **AI Agent integration** - The agents system can already create/update/search tasks. This is ahead of most competitors.

5. **Recurring tasks** - Built-in with proper next-instance spawning. Jira doesn't have this natively.

6. **Custom field type schemas** - Per-task-type required fields is sophisticated. Most competitors don't have this.

7. **Unified workspace** - Tasks live alongside notes, files, calendar, chat. This is the value prop - don't let project management feel disconnected from the rest of the workspace.

---

## 9. Summary

Uniffy's projects domain has a **strong backend** with most data models in place, but the **UI doesn't surface the power effectively** and several **critical competitive features are missing**. The biggest gaps are:

1. **No "My Work" view** - users can't see their tasks across projects
2. **No dedicated task page** - tasks only viewable in sidebar/modal, no full-page view for focused work
3. **No labels/tags** - fundamental categorization is missing
4. **Weak bulk operations** - power users can't manage at scale
5. **No saved views/filters** - filters are lost on every page load
6. **No automation** - manual repetitive work that competitors automate
7. **UI feels like viewing data, not doing work** - needs action-oriented design

The dependency graph, resource view, recurring tasks, and universal mentions are genuine differentiators. The strategy should be: close the critical gaps in Phase 1-2, refine the UI in Phase 3, then build automation and AI features in Phase 4-5 to differentiate beyond feature parity.
