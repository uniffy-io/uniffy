# Permissions Redesign - Frontend Refactor Plan

> This plan will be executed by Sonnet. Each phase is self-contained enough to land as one coherent change. Phases must be executed in order - cross-phase dependencies are marked explicitly.

## Context

The backend permissions redesign is complete (`docs/specs/permissions-redesign.md`, backlog phases 0 and 1). It replaces the old model with:

- `AccessMode` enum: `OWNER_ONLY` / `EXPLICIT_MEMBERS` / `OPEN_TO_ORG`
- `ContentRole` enum: `VIEWER` < `COMMENTER` < `EDITOR` < `ADMIN` < `OWNER`, plus `BLOCKED` (explicit deny)
- `ContentMember` rows (one per user/group per content) replacing `ContentPermission` + `ContentGroupLink`
- `ContentMemberEvent` audit log
- Per-content `owner_id` + `access_mode` + `baseline_role` columns
- New `permissions.v1.MembersService` with 7 RPCs: `ListMembers`, `AddMember`, `UpdateMemberRole`, `RemoveMember`, `SetAccessMode`, `TransferOwnership`, `ListMemberEvents`

The generated TS proto (`src/gen/typescript/`) is already regenerated and matches the backend. The old `VisibilityScope` / `PermissionLevel` enums and old `PermissionsService` do **not** exist in the generated code anymore - any frontend file that imports them is already broken. The frontend is lagging behind and still uses the old model throughout, which is why `./run.sh lint-frontend` / compilation is currently unclean. This plan brings the frontend up to match.

**Goal:** delete `src/ui/src/features/sharing/` entirely, build a new `src/ui/src/features/permissions/` feature, rewrite every content domain (notes / files / calendar / projects / agents / rooms / admin) to use the new model, and wire the sidebar bucketing rules from spec section 3.5a.

**Out of scope:**
- Backend changes (done)
- Proto changes (done)
- Removing legacy backend stub RPCs in `notes.proto` (follow-up task tracked in backlog)
- Hierarchical inheritance, time-bound cleanup cron, GDPR anonymization, public sharing, templates (all explicit non-goals in the spec)

---

## Locked decisions (don't revisit)

1. **Centralize all per-content access state in one new `permissions` Redux slice**, keyed by `${contentType}:${contentId}`. Do NOT duplicate members/policy/audit onto each domain's own slice. Rationale: symmetric data, different fetch rhythm from content lists, matches service boundary.
2. **Keep per-content `userRole` on the domain slice rows** (e.g. `project.userRole`, `file.userRole`). Do not duplicate it on the permissions slice. Source of truth is the content row itself - the proto already carries it.
3. **`AccessModeSelector` is one component, not two.** A 3-option picker with the baseline-role dropdown conditionally rendered inline under `OPEN_TO_ORG`. Switching away from `OPEN_TO_ORG` clears baseline in local state; switching to `OPEN_TO_ORG` seeds baseline from the org default (or `VIEWER` as fallback). This enforces the backend invariant by construction.
4. **Sidebar bucketing (spec 3.5a, locked):**
   - Personal = `owner_id === me` AND `access_mode !== OPEN_TO_ORG`
   - Shared with me = `owner_id !== me` AND `access_mode !== OPEN_TO_ORG`
   - Organization = `access_mode === OPEN_TO_ORG` (regardless of ownership)
   - No "Groups" section. Groups collapse into Shared.
   - BLOCKED content is excluded server-side.
5. **`AccessPolicyPanel` is the bare panel** (no chrome, embeddable). `AccessPolicyDialog` is a thin `<Dialog>` wrapper around it. Both exist. Settings pages embed the panel; EditorHeader / FilesList / AgentsView etc. open the dialog.
6. **Rooms and Calendar keep their `'private' | 'organization'` string facade at the form level**, but the thunks translate to `{accessMode, baselineRole}` at the API boundary. Rooms/Calendar don't have a real per-content members panel UX today - the two-button toggle stays.
7. **Embedded-media uploads** (image/audio/video inside notes/canvas) default to `OWNER_ONLY`, not `OPEN_TO_ORG`. They inherit visibility from the parent note in the backend, not from a hardcoded frontend default.
8. **Domain implementation order** (once Phase 0-1.6 lands): Projects -> Notes -> Files -> Agents -> Calendar -> Rooms. Projects is the most complex (full settings page + userRole on both Project and Task). Once projects is done, the pattern is locked for everyone else.

---

## Reference material

Always keep these open while implementing:

- `docs/specs/permissions-redesign.md` sections: Core model, Access function, Per-domain impact, Edge cases, Frontend impact (3.5a bucketing rules locked here)
- `docs/specs/permissions-redesign-backlog.md` Phase 3 sub-items for scoping
- `docs/agents/frontend.md` for conventions (no default exports, absolute imports, useDocumentTitle, zen mode, responsive tiers, error toasting, lazy loading)

Existing patterns to reuse verbatim:

| Use | Import from |
|---|---|
| Avatars, chips, picker | `@/components/subject/` - `SubjectAvatar`, `SubjectAvatarStack`, `SubjectChip`, `SubjectPicker`, `useSubjectResolver` |
| Initials helper | `@/components/subject/utils` - `getInitials` (never define locally) |
| Date/time formatting | `@/shared/utils/dateFormatting` - `formatRelativeTime`, `formatProtoDateTime` for audit log |
| Error toasts | automatic via `errorToastMiddleware` - thunks just `rejectWithValue`, never call `toast.error()` manually |
| Theme colors | `bg-card`, `bg-muted`, `text-primary`, `text-muted-foreground`, `border-border` - never hardcode hex |
| Icons | `@phosphor-icons/react` |
| Dialog primitive | `@headlessui/react` `Dialog` + `Transition` (see `SharingDialog.tsx` for the pattern to copy into `AccessPolicyDialog`) |
| Store registration | `src/ui/src/app/store.ts` - one-line import + one-line `combineReducers` entry |

---

## Phase 0 - Shared helpers

Goal: create the single source of truth for role/access-mode logic before any consumer code runs.

### 0.1 Create `src/ui/src/shared/utils/contentRoles.ts`

New file. Mirrors the backend `core/auth/permissions/roles.py`. Exports:

```ts
import { ContentRole, AccessMode } from '@uniffy/proto/common/v1/common_pb';

export const ROLE_ORDINAL: Record<ContentRole, number> = {
  [ContentRole.UNSPECIFIED]: -2,
  [ContentRole.BLOCKED]: -1,
  [ContentRole.VIEWER]: 1,
  [ContentRole.COMMENTER]: 2,
  [ContentRole.EDITOR]: 3,
  [ContentRole.ADMIN]: 4,
  [ContentRole.OWNER]: 5,
};

export const roleCanView = (role: ContentRole | null | undefined): boolean => ...
export const roleCanComment = (role) => ...
export const roleCanEdit = (role) => ...
export const roleCanDelete = (role) => ...
export const roleCanManage = (role) => ...   // ADMIN+, gates member management + access mode changes
export const roleCanTransfer = (role) => ... // OWNER only

export const roleLabel = (role: ContentRole): string => ...        // "Viewer", "Commenter", "Editor", "Admin", "Owner", "Blocked"
export const accessModeLabel = (mode: AccessMode): string => ...   // "Only owner", "Invited people", "Everyone in org"
export const accessModeDescription = (mode: AccessMode): string => ...
// Returns a Phosphor icon component ref. OWNER_ONLY -> LockSimple, EXPLICIT_MEMBERS -> Users, OPEN_TO_ORG -> Buildings.
export const accessModeIcon = (mode: AccessMode) => ...

// Returns 'personal' | 'shared' | 'organization' per spec section 3.5a.
export const bucketForContent = (params: {
  ownerId: string;
  accessMode: AccessMode;
  currentUserId: string;
}): 'personal' | 'shared' | 'organization' => ...

// Predicates usable inside Array.filter() for sidebar bucketing.
export const isInPersonalBucket = (content, userId) => bucketForContent(...) === 'personal';
export const isInSharedBucket = (content, userId) => ...;
export const isInOrganizationBucket = (content) => content.accessMode === AccessMode.OPEN_TO_ORG;

// Baseline roles valid in the picker (excludes OWNER and BLOCKED per spec).
export const VALID_BASELINE_ROLES: readonly ContentRole[] = [
  ContentRole.VIEWER,
  ContentRole.COMMENTER,
  ContentRole.EDITOR,
  ContentRole.ADMIN,
];
```

Do not add anything else here. No React imports - this is a pure utility module.

**Verification:** `rg "roleCanView\|roleCanEdit\|roleCanManage\|roleCanTransfer\|accessModeLabel\|bucketForContent" src/ui/src` should start producing hits once Phase 2 begins.

---

## Phase 1 - Build `src/ui/src/features/permissions/` feature

Goal: create the complete new feature module. No consumers yet - this phase is isolated.

### 1.1 Directory scaffolding

```
src/ui/src/features/permissions/
  api/
    membersApi.ts
  store/
    permissionsSlice.ts
    permissionsThunks.ts
  hooks/
    useContentMembers.ts
    useContentAuditLog.ts
    useMyContentRole.ts
  components/
    AccessPolicyPanel.tsx
    AccessPolicyDialog.tsx
    AccessModeSelector.tsx
    ContentRoleBadge.tsx
    ContentRoleSelect.tsx
    MemberRow.tsx
    AddMemberPopover.tsx
    BlockedMembersSection.tsx
    AuditLogPanel.tsx
  index.ts
```

### 1.2 `api/membersApi.ts`

```ts
import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { MembersService } from '@uniffy/proto/permissions/v1/permissions_connect';

const client = createClient(MembersService, transport);

export const membersApi = {
  listMembers:       (req) => client.listMembers(req),
  addMember:         (req) => client.addMember(req),
  updateMemberRole:  (req) => client.updateMemberRole(req),
  removeMember:      (req) => client.removeMember(req),
  setAccessMode:     (req) => client.setAccessMode(req),
  transferOwnership: (req) => client.transferOwnership(req),
  listMemberEvents:  (req) => client.listMemberEvents(req),
};
```

Do NOT add the client to `config/api.ts` - keep it local to the feature module.

### 1.3 `store/permissionsSlice.ts`

State shape (serialized - no BigInt, no proto classes, no Date):

```ts
interface ContentAccessPolicy {
  ownerId: string;
  accessMode: number;              // AccessMode
  baselineRole: number | null;     // ContentRole or null
}

interface SerializedContentMember {
  subjectType: number;             // SubjectType (USER / GROUP)
  subjectId: string;
  role: number;                    // ContentRole
  addedByUserId: string;
  addedAt: { seconds: string; nanos: number } | null;
  updatedAt: { seconds: string; nanos: number } | null;
  expiresAt: { seconds: string; nanos: number } | null;
}

interface SerializedMemberEvent {
  id: string;
  contentType: number;
  contentId: string;
  action: number;                  // ContentMemberAction
  subjectType: number | null;
  subjectId: string | null;
  previousRole: number | null;
  newRole: number | null;
  previousAccessMode: number | null;
  newAccessMode: number | null;
  previousBaselineRole: number | null;
  newBaselineRole: number | null;
  previousOwnerId: string | null;
  newOwnerId: string | null;
  actorUserId: string;
  actorOrgRole: number;
  note: string;
  occurredAt: { seconds: string; nanos: number } | null;
}

interface PermissionsState {
  byContent: Record<string, {      // key = `${contentType}:${contentId}`
    policy: ContentAccessPolicy | null;
    members: SerializedContentMember[];
    auditEvents: SerializedMemberEvent[];
    auditCursor: number | null;    // page number for next load, null = no more
    loading: { members: boolean; audit: boolean; mutation: boolean };
    errors: { members: string | null; audit: string | null; mutation: string | null };
  }>;
}
```

Actions:
- `clearPermissions()` - wipes `byContent` entirely. Used on logout and org switch.
- `clearContentMembers(key)` - wipes one entry.
- Plus the standard `extraReducers` for each thunk below (pending / fulfilled / rejected).

Export: `permissionsReducer` (NAMED export - no default exports ever).

### 1.4 `store/permissionsThunks.ts`

```ts
export const fetchContentMembers = createAsyncThunk<
  { policy: ContentAccessPolicy; members: SerializedContentMember[] },
  { contentType: number; contentId: string },
  { state: RootState }
>('permissions/fetchContentMembers', async ({ contentType, contentId }, { getState, rejectWithValue }) => {
  const organizationId = getState().auth.currentOrganizationId;
  if (!organizationId) return rejectWithValue('No organization selected');
  try {
    const response = await membersApi.listMembers({ organizationId, contentType, contentId });
    return { policy: serializePolicy(response.policy!), members: response.members.map(serializeMember) };
  } catch (err) {
    return rejectWithValue(err instanceof Error ? err.message : 'Failed to fetch members');
  }
});

export const addContentMember = createAsyncThunk<...>('permissions/addMember', ...);
export const updateContentMemberRole = createAsyncThunk<...>('permissions/updateMemberRole', ...);
export const removeContentMember = createAsyncThunk<...>('permissions/removeMember', ...);
export const setContentAccessMode = createAsyncThunk<
  { policy: ContentAccessPolicy },
  { contentType: number; contentId: string; accessMode: number; baselineRole: number | null; removeMembersOnNarrow?: boolean; note?: string },
  { state: RootState }
>('permissions/setAccessMode', ...);
export const transferContentOwnership = createAsyncThunk<...>('permissions/transferOwnership', ...);
export const fetchContentAuditLog = createAsyncThunk<
  { events: SerializedMemberEvent[]; nextPage: number | null },
  { contentType: number; contentId: string; page?: number; pageSize?: number; actorUserId?: string; action?: number },
  { state: RootState }
>('permissions/fetchAuditLog', ...);
```

**Critical rules for thunks (from `docs/agents/frontend.md`):**
- Never call `toast.error()`. Use `rejectWithValue(err.message)`. The `errorToastMiddleware` handles display.
- Serialize Timestamp (`{ seconds, nanos }`) as `{ seconds: string, nanos: number }` - BigInt is not serializable.
- Always scope by `organizationId` from `getState().auth.currentOrganizationId`.

### 1.5 `hooks/useContentMembers.ts`

```ts
export function useContentMembers(contentType: number, contentId: string) {
  const dispatch = useAppDispatch();
  const key = `${contentType}:${contentId}`;
  const entry = useAppSelector((s) => s.permissions.byContent[key]);

  useEffect(() => {
    if (contentId && !entry) dispatch(fetchContentMembers({ contentType, contentId }));
  }, [contentType, contentId, dispatch, entry]);

  return {
    policy: entry?.policy ?? null,
    members: entry?.members ?? [],
    loading: entry?.loading.members ?? false,
    error: entry?.errors.members ?? null,
    add:      (subjectType, subjectId, role, expiresAt?, note?) => dispatch(addContentMember({...})),
    update:   (subjectType, subjectId, newRole, note?) => dispatch(updateContentMemberRole({...})),
    remove:   (subjectType, subjectId, note?) => dispatch(removeContentMember({...})),
    setMode:  (accessMode, baselineRole, removeMembersOnNarrow?, note?) => dispatch(setContentAccessMode({...})),
    transfer: (newOwnerUserId, note?) => dispatch(transferContentOwnership({...})),
  };
}
```

### 1.6 `hooks/useContentAuditLog.ts`

Paginated hook returning `{ events, loading, error, loadMore, reset, filters, setFilters }`. Filters: `actorUserId?`, `action?`, date range (optional, low priority).

### 1.7 `hooks/useMyContentRole.ts`

Pure derivation - does NOT fetch. Reads the content row's existing `userRole` field from wherever it lives (project, note, file, agent, etc.), so this is just a small selector pattern:

```ts
export function useMyContentRole(contentType: number, contentId: string): ContentRole | null {
  // Look up the row in the appropriate domain slice by (type, id) and return its userRole.
  // For types without a domain slice entry (e.g. provider key, prompt), fall back to derivation
  // via useContentMembers + bucketForContent.
}
```

This replaces the old `useMyPermission` hook from `features/sharing`. Callers are:

- `features/agents/components/views/AgentsView/InstructionsTab.tsx`
- `features/agents/components/views/AgentsView/OverviewTab.tsx`
- `features/agents/components/views/AgentsView/SkillsTab.tsx`
- `features/agents/components/views/AgentsView/ToolsTab.tsx`
- `features/notes/components/editor/NotesEditor.tsx`
- `features/notes/components/editor/EditorHeader.tsx`

Each caller uses the result through `roleCanEdit` / `roleCanManage` helpers from `shared/utils/contentRoles.ts`.

### 1.8 Components

**`ContentRoleBadge.tsx`** - displays a role with color. Use the badge pattern from `docs/agents/frontend.md` (no hardcoded colors; use theme classes or the existing badge color convention from other badges in the app).

**`ContentRoleSelect.tsx`** - dropdown for selecting a ContentRole. Optional `excludeRoles` prop (e.g. exclude `OWNER` for add-member, exclude `BLOCKED` for baseline). Uses `@/components/ui/select` or an inline headless listbox matching the style of the existing `PermissionLevelSelect` in features/sharing.

**`AccessModeSelector.tsx`** - the single unified control. 3-option picker:

```
(o) Only me                       [LockSimple icon]
( ) Invited people only           [Users icon]
( ) Everyone in this organization [Buildings icon]
    |- Baseline role: [Viewer v]  (only shown when OPEN_TO_ORG selected; dropdown excludes OWNER and BLOCKED)
    |- "This item will appear in the Organization section"  (helper text)
```

Props:

```ts
interface AccessModeSelectorProps {
  value: { accessMode: AccessMode; baselineRole: ContentRole | null };
  onChange: (value: { accessMode: AccessMode; baselineRole: ContentRole | null }) => void;
  disabled?: boolean;
  // Optional default baseline role to seed when user switches to OPEN_TO_ORG (from org defaults).
  defaultBaselineRole?: ContentRole;
}
```

Invariants enforced by the component:
- Switching to `OWNER_ONLY` or `EXPLICIT_MEMBERS` -> calls `onChange({mode, baselineRole: null})`.
- Switching to `OPEN_TO_ORG` -> calls `onChange({mode, baselineRole: defaultBaselineRole ?? VIEWER})`.
- Baseline dropdown only renders when `value.accessMode === OPEN_TO_ORG`.
- Baseline dropdown options: `VALID_BASELINE_ROLES` from `contentRoles.ts`.

**`MemberRow.tsx`** - avatar + name + role picker + remove button. Uses `SubjectAvatar` from `@/components/subject/`. Role changes call `update(...)` on `useContentMembers`. A variant renders BLOCKED members with muted styling (used by `BlockedMembersSection`).

Props:
```ts
interface MemberRowProps {
  member: SerializedContentMember;
  canEdit: boolean;                // disabled when actor doesn't have MANAGE
  onUpdate: (newRole: ContentRole) => Promise<void>;
  onRemove: () => Promise<void>;
  // If true, render as a blocked-member row (muted, "Unblock" button instead of role picker).
  blocked?: boolean;
}
```

**`AddMemberPopover.tsx`** - wraps the existing `SubjectPicker` from `@/components/subject/` + a `ContentRoleSelect`. Calls `add(...)` on submit. Excludes the current owner + already-added subjects from search results via the picker's `existingSubjectIds` prop.

**`BlockedMembersSection.tsx`** - dedicated subsection that renders only the members with `role === BLOCKED`. Collapsed by default, expands to show member rows with "Unblock" buttons (which call `update` with a prompt for new role, or `remove`).

**`AccessPolicyPanel.tsx`** - the main composition. Lays out:

1. **Owner row** - avatar, "(you)" suffix if current user, "Transfer ownership" button (only shown to actors with `roleCanTransfer`).
2. **Access mode section** - `AccessModeSelector`. On change: calls `setMode(...)`. Disabled if actor doesn't have `roleCanManage`.
3. **Members section** - `AddMemberPopover` trigger + list of non-blocked `MemberRow`s, sorted groups-first then users.
4. **Blocked section** - `BlockedMembersSection`.
5. **Audit log link** - "View access history" link that opens `AuditLogPanel` in a drawer or new tab.

Props:
```ts
interface AccessPolicyPanelProps {
  contentType: number;
  contentId: string;
  contentTitle?: string;
  // Optional: hide audit log link (e.g. for embedded panel in project settings)
  showAuditLink?: boolean;
}
```

Internally calls `useContentMembers(contentType, contentId)`. The panel is the bare body; callers decide whether to wrap it in a dialog, card, or page section.

**`AccessPolicyDialog.tsx`** - thin `<Dialog>` wrapper. Uses Headless UI `Dialog` + `Transition` matching the existing `SharingDialog.tsx` shell. The wrapper owns `isOpen`/`onClose`; the panel owns the content. Exports a `useAccessPolicyDialog()` hook returning `{ isOpen, openFor, close, activeContent }` (Redux-backed or local component state - local is simpler and matches the "don't centralize activeContent" rule from locked decisions).

Actually: **use local React state (via a shared context provider)** for dialog open/close. Put `AccessPolicyDialogProvider` at the app root and expose `useAccessPolicyDialog()` that returns `{ openFor(contentType, contentId, title?), close }`. This way the dialog is mounted once in `App.tsx` and every consumer just calls `openFor()`. This mirrors how the old `useSharingDialog` worked but without the Redux state.

**`AuditLogPanel.tsx`** - read-only list of events from `useContentAuditLog`. Each event shows actor avatar + descriptive sentence + relative time (via `formatRelativeTime` from `@/shared/utils/dateFormatting`). Use `formatProtoDateTime` on hover. Filter controls for actor and action type. Pagination via "Load more" button.

Event sentence formatting (one helper per action):
- `MEMBER_ADDED` - "{actor} added {subject} as {newRole}"
- `MEMBER_ROLE_CHANGED` - "{actor} changed {subject}'s role from {previousRole} to {newRole}"
- `MEMBER_REMOVED` - "{actor} removed {subject}"
- `ACCESS_MODE_CHANGED` - "{actor} changed access from {previousAccessMode} to {newAccessMode}"
- `BASELINE_ROLE_CHANGED` - "{actor} changed the baseline role from {previousBaselineRole} to {newBaselineRole}"
- `OWNERSHIP_TRANSFERRED` - "{actor} transferred ownership to {subject}"

Subject resolution uses `useSubjectResolver` from `@/components/subject/`.

### 1.9 `index.ts` barrel

Export everything public. NAMED exports only:

```ts
export { permissionsReducer } from './store/permissionsSlice';
export { clearPermissions, clearContentMembers } from './store/permissionsSlice';
export { fetchContentMembers, addContentMember, /* ... */ } from './store/permissionsThunks';
export { useContentMembers } from './hooks/useContentMembers';
export { useContentAuditLog } from './hooks/useContentAuditLog';
export { useMyContentRole } from './hooks/useMyContentRole';
export { useAccessPolicyDialog, AccessPolicyDialogProvider } from './components/AccessPolicyDialog';
export { AccessPolicyPanel } from './components/AccessPolicyPanel';
export { AccessPolicyDialog } from './components/AccessPolicyDialog';
export { AccessModeSelector } from './components/AccessModeSelector';
export { ContentRoleBadge } from './components/ContentRoleBadge';
export { ContentRoleSelect } from './components/ContentRoleSelect';
export { AuditLogPanel } from './components/AuditLogPanel';
export type { /* serialized types */ } from './store/permissionsSlice';
```

### 1.10 Mount the Provider and Dialog globally

Add `<AccessPolicyDialogProvider>` near the root of `App.tsx` (inside `<ProtectedRoute>` scope or at the same level as the existing global modals). Render a singleton `<AccessPolicyDialog />` next to the existing global dialogs.

**Phase 1 verification:** `./run.sh lint-frontend` must still fail (the old sharing feature is still wired). Just verify the new feature module itself has no lint errors by running ruff/eslint on the directory in isolation if possible, or at minimum verify there are no syntax errors.

---

## Phase 1.5 - Replace subject search dependency

Goal: break the hidden dependency of `@/components/subject/hooks/useSubjectSearch` on `features/sharing/store/sharingThunks.ts` BEFORE any domain work starts.

### 1.5.1 Rewrite `src/ui/src/components/subject/hooks/useSubjectSearch.ts`

Today it imports `searchShareTargets` and `clearSearchResults` from `@/features/sharing/store/sharingThunks` and reads `state.sharing.searchResults` / `state.sharing.searchLoading`.

Replace with a local, non-Redux debounced search that calls two existing services:

- `OrganizationsService.ListMembers({ organizationId, searchQuery, limit })` for users
- `OrganizationsService.ListGroups({ organizationId, searchQuery, limit })` for groups (if the frontend has an admin/groups listing; if not, use `GroupsService.ListGroups` directly)

Both clients already exist - check `features/admin/api/adminApi.ts` for wrappers if available. If not, instantiate local clients inside the hook module.

Combine results client-side into a list of `Subject` objects (`{ type: 'user' | 'group', id, name, avatarUrl?, email? }`). Use a 300ms debounce. Return `{ results, loading, error, search(query), clear() }`.

This hook now has NO Redux dependency - results live in the hook's local `useState`.

### 1.5.2 Update `src/ui/src/components/subject/utils.ts`

Delete imports from `@/features/sharing`:
- `SerializedShareTarget` type import
- `shareTargetToSubject` / `subjectToShareTarget` converter functions (if they have no other callers, delete them entirely)

Run `rg "shareTargetToSubject\|subjectToShareTarget\|SerializedShareTarget" src/ui/src` - every hit needs to be replaced with the `Subject` type directly.

### 1.5.3 Verify `SubjectPicker` still compiles

`SubjectPicker` imports `useSubjectSearch`. After 1.5.1 it should still work because the hook's return shape is preserved (`results: Subject[]`, `search(query)`, etc.). Verify by reading `SubjectPicker.tsx` and confirming no changes needed.

**Phase 1.5 verification:** `rg "from '@/features/sharing'" src/ui/src/components/subject` returns zero matches.

---

## Phase 1.6 - Per-domain serialization layer rewrite

Goal: update every domain's `api/*.ts` / `store/*Thunks.ts` and frontend types to serialize the new proto fields. This MUST happen before any component work, because components read from the serialized types.

Do one domain at a time in this order: **projects -> notes -> files -> agents -> calendar -> rooms**. After each domain compiles (at least its serialization layer), move on.

### 1.6.1 Projects (most complex, sets the pattern)

**`src/ui/src/features/projects/types/project.ts`:**

```ts
// DELETE:
export type VisibilityScope = 'PRIVATE' | 'ORGANIZATION';
// on Project: visibility, memberIds, userPermissionLevel
// on Task:    userPermissionLevel

// ADD (on Project):
accessMode: number;                     // AccessMode enum value
baselineRole: number | null;            // ContentRole or null (non-null iff accessMode === OPEN_TO_ORG)
userRole: number;                       // ContentRole - current user's effective role

// ADD (on Task):
userRole: number;                       // ContentRole

// Same for CreateProjectRequest / UpdateProjectRequest:
// replace `visibility` with optional `accessMode` + `baselineRole`.
```

**`src/ui/src/features/projects/api/projectsApi.ts`:**

- **Delete** `frontendVisibilityToProto` and `protoVisibilityToFrontend` (lines ~51-84).
- **`protoProjectToFrontend`** (line ~169): drop `visibility`, `memberIds`, `userPermissionLevel`. Add `accessMode: proto.accessMode`, `baselineRole: proto.baselineRole ?? null`, `userRole: proto.userRole`.
- **`protoTaskToFrontend`** (line ~241): drop `userPermissionLevel`. Add `userRole: proto.userRole`.
- **`createProject`** (line ~428): replace `visibility: frontendVisibilityToProto(...)` with `accessMode: data.accessMode, baselineRole: data.baselineRole` (both optional - backend applies defaults).
- **`updateProject`** (line ~461): same swap. **IMPORTANT**: update no longer accepts access mode changes. Access mode changes go through `MembersService.SetAccessMode`. Remove the field entirely from `updateProject`'s payload, OR keep it for initial create only.
- Remove any `VisibilityScope` / `PermissionLevel` imports.

**`src/ui/src/features/projects/store/projectsThunks.ts`:**
- Any thunks that pass `visibility` - update signatures.

**`src/ui/src/features/projects/hooks/useProjectPermissions.ts`:**

Rewrite around `project.userRole` + `roleCan*` helpers:

```ts
import { roleCanEdit, roleCanManage, roleCanDelete } from '@/shared/utils/contentRoles';

export function useProjectPermissions(project: Project | null | undefined) {
  const role = project?.userRole ?? null;
  return {
    canView:   roleCanView(role),
    canEdit:   roleCanEdit(role),
    canManage: roleCanManage(role),    // replaces canAdmin
    canDelete: roleCanDelete(role),
    canTransferOwnership: roleCanTransfer(role),
  };
}

// useTaskPermission: same pattern, reads task.userRole; if task.userRole is unset, falls back to project.userRole via the currentProjectId lookup.
```

**`src/ui/src/features/projects/components/CreateProjectModal.tsx` (line ~42):**

Replace the `visibility` seeding from `projectScope`:

```ts
// OLD:
visibility: projectScope === 'organization' ? 'ORGANIZATION' : 'PRIVATE',
// NEW:
accessMode: projectScope === 'organization' ? AccessMode.OPEN_TO_ORG : AccessMode.OWNER_ONLY,
baselineRole: projectScope === 'organization' ? ContentRole.EDITOR : null,
```

### 1.6.2 Notes

**`src/ui/src/features/notes/store/notesThunks.ts`:**

- `noteToPlain` (line ~42): drop `visibility`, `groupIds`, `sharedWith`, `ownerInfo` (these all came from the legacy permission service; now they come via `MembersService.ListMembers`). Keep `ownerId` (proto still has it). Add `accessMode`, `baselineRole`, `userRole`.
- `SerializedNote` (line ~91) - type auto-updates from the `ReturnType`.
- `fetchNotes`, `createNote`, `updateNote`, `moveNote` (lines ~109, 248, 481, 506): remove `visibility?: VisibilityScope` and `targetGroupIds` params. Add optional `accessMode` / `baselineRole`. Note that `updateNote` SHOULD NOT accept access-mode changes directly - those go through `MembersService.SetAccessMode`.

**`src/ui/src/features/notes/store/notesSlice.ts` / `notesTreeSlice.ts`:**

- Drop all `VisibilityScope` imports.
- `notesTreeSlice.ts` lines ~512-681: the WebSocket update reducer switches on `VisibilityScope.GROUP/ORGANIZATION/PRIVATE`. Rewrite the bucketing logic to call `bucketForContent` from `@/shared/utils/contentRoles`.
- Delete `GroupTreeSection` type and `groups` field from `OrganizedNotes`.

**`src/ui/src/features/notes/utils/notesTreeUtils.ts`:**

Rename `organizeNotesByVisibility` to `organizeNotesBySection`. Drop the `userGroups` parameter. New signature:

```ts
export function organizeNotesBySection(
  notes: SerializedNote[],
  currentUserId: string,
): OrganizedNotes {
  const personal: SerializedNote[] = [];
  const shared: SerializedNote[] = [];
  const organization: SerializedNote[] = [];
  const trash: SerializedNote[] = [];

  notes.forEach((note) => {
    if (note.isDeleted) { trash.push(note); return; }
    const bucket = bucketForContent({
      ownerId: note.ownerId,
      accessMode: note.accessMode,
      currentUserId,
    });
    if (bucket === 'personal') personal.push(note);
    else if (bucket === 'shared') shared.push(note);
    else organization.push(note);
  });

  return {
    bookmarked: [],
    personal: buildNoteHierarchy(personal),
    shared: buildNoteHierarchy(shared),
    organization: buildNoteHierarchy(organization),
    trash: trash.map(noteToTreeNode),
  };
}

// Delete GroupTreeSection and OrganizedNotes.groups
export interface OrganizedNotes {
  bookmarked: TreeNode[];
  personal: TreeNode[];
  shared: TreeNode[];
  organization: TreeNode[];
  trash: TreeNode[];
}
```

Update all 3 call sites (search `organizeNotesByVisibility` - 2 in `notesThunks.ts`, 1 in `notesTreeSlice.ts`). At each call site, the `userGroups` argument disappears and any `selectUserGroups` dep becomes dead.

**`TreeNode.visibility`** in `notesTreeSlice.ts` - replace with `accessMode` + `ownerId` (or drop if unused after the sidebar rewrite). Also update `noteToTreeNode` in `notesTreeUtils.ts`.

### 1.6.3 Files

**`src/ui/src/features/files/store/filesThunks.ts`:**
- `fileToPlain` (line ~29): `proto.visibility` -> add `accessMode`, `baselineRole`, `userRole`.
- `fetchFiles`, `createFile`, `moveFiles` (lines ~93, 167, 251): drop `visibility?` params. Access mode changes go through `MembersService`.

**`src/ui/src/features/files/store/filesSlice.ts`:**
- Line ~126 `filters.visibility: VisibilityScope | 'all'` - delete.
- Line ~372 `setVisibilityFilter` action - delete.
- Drop all `VisibilityScope` imports.

**`src/ui/src/features/files/store/selectors.ts`:**

Critical: `selectFilesForCurrentFolderAndScope` (lines ~139-197) currently filters on `VisibilityScope.PRIVATE`/`ORGANIZATION`. Rewrite using `bucketForContent`:

```ts
const currentUserId = state.auth.user?.id;
const bucket = state.files.filters.viewScope;  // 'all' | 'personal' | 'shared' | 'organization'
if (bucket === 'all') return files;
if (bucket === 'shared') {
  // Keep the "flat view across all folders" behavior for shared files.
  return files.filter(f => isInSharedBucket(f, currentUserId));
}
return files.filter(f =>
  bucket === 'personal' ? isInPersonalBucket(f, currentUserId) : isInOrganizationBucket(f)
);
```

**`src/ui/src/features/files/store/filesTreeSlice.ts`** (lines ~162-229): tree-building reducer switches on `VisibilityScope`. Same rewrite using `bucketForContent`.

**`src/ui/src/features/files/store/filesTreeThunks.ts`** (lines ~50-145): `createFolder` and `moveNodes` take `visibility: VisibilityScope` - drop. Folders inherit `accessMode`/`baselineRole` from parent.

**`src/ui/src/features/files/store/savedFiltersSlice.ts`** (lines ~20, 85-86, 186, 237): `SerializedFilterCriteria.visibility` field. Delete the field entirely. Persisted filters will drop the field naturally; add a migration in `savedFiltersSlice` initialState or use a normalizing selector to strip unknown fields.

**`src/ui/src/features/files/store/uploadSlice.ts`** (line ~33): `visibility?: number` on upload item metadata - delete.

**`src/ui/src/features/files/store/viewerThunks.ts` and `hooks/useUploadProcessor.ts`**: replace `userPermissionLevel` with `userRole`.

### 1.6.4 Agents

Each sub-domain (agents / provider keys / prompts / cron tasks) has its own slice + thunks + types. For each:

- Drop `visibility`, add `accessMode` / `baselineRole` / `userRole`.
- Drop `userPermissionLevel` if present.
- The thunk for "move to org" in PromptsView (see Phase 2) needs to be rewritten as a `setContentAccessMode` call via `MembersService`, not an `UpdatePrompt` call.

### 1.6.5 Calendar

**`src/ui/src/features/calendar/store/calendarThunks.ts`** (lines ~163-175):

Delete the `VISIBILITY_TO_PROTO`/`VISIBILITY_FROM_PROTO` map. Replace with:

```ts
function frontendVisibilityToAccessMode(v: 'private' | 'organization'): { accessMode: number; baselineRole: number | null } {
  return v === 'organization'
    ? { accessMode: AccessMode.OPEN_TO_ORG, baselineRole: ContentRole.VIEWER }
    : { accessMode: AccessMode.OWNER_ONLY, baselineRole: null };
}

function accessModeToFrontendVisibility(mode: number): 'private' | 'organization' {
  return mode === AccessMode.OPEN_TO_ORG ? 'organization' : 'private';
}
```

Apply at the create/update serialization boundary. Keep the frontend type `event.visibility: 'private' | 'organization'` as a facade - the modals don't need to know about the real enums.

`types/event.ts` line ~104: keep `visibility: 'private' | 'organization'`. Optional: also expose `accessMode` / `baselineRole` for code that needs them.

`hooks/useCalendarEvents.ts` lines ~58-69: keeps its `event.visibility === 'private'/'organization'` filter - it's populated by the serialization layer now.

### 1.6.6 Rooms

**`src/ui/src/features/rooms/store/roomsThunks.ts`** (lines ~95-107): same pattern as calendar. Keep `room.visibility: 'private' | 'organization'` as a facade; the thunk translates.

`types/room.ts` line ~18: unchanged.

### 1.6.7 Admin slice

**`src/ui/src/features/admin/store/adminSlice.ts`:**

```ts
// OLD:
interface SerializedContentTypeDefaults {
  contentType: number;
  defaultVisibility: number;
  membersCanView: boolean;
  membersCanEdit: boolean;
  membersCanDelete: boolean;
  membersCanShare: boolean;
  updatedAt: { seconds: number; nanos: number } | null;
}

// NEW:
interface SerializedContentTypeDefaults {
  contentType: number;
  defaultAccessMode: number;       // AccessMode
  defaultBaselineRole: number | null;  // ContentRole or null (non-null iff OPEN_TO_ORG)
  updatedAt: { seconds: string; nanos: number } | null;
}
```

`serializeContentTypeDefaults` (line ~104): rewrite around new fields.

**`src/ui/src/features/admin/store/adminThunks.ts`:**

- Drop `VisibilityScope` import (line ~14); import `AccessMode` and `ContentRole` instead.
- `updatePermissionDefaults` thunk (lines ~50-82): rewrite payload to `{ defaultAccessMode, defaultBaselineRole }`.
- Remove any `members_can_*` references.

**`src/ui/src/features/admin/hooks/useAdminHooks.ts`** (lines ~28, 295-301): drop `VisibilityScope` references; adjust `usePermissionDefaults` return shape to match the new slice.

**Phase 1.6 verification:** After each domain's serialization layer is done, that domain's types should type-check against the new proto. The UI components for that domain may still be broken (they still reference the old types) - that's Phase 2.

---

## Phase 2 - Per-domain UI rewrites

Goal: update every content domain's UI (settings pages, edit modals, sidebars, dialogs, detail panels) to consume the new serialized types and use the new permissions feature.

Do one domain at a time in the same order as Phase 1.6: **projects -> notes -> files -> agents -> calendar -> rooms -> admin**.

For each domain, the pattern is:

1. **Delete visibility radio / selector** from any "Visibility" section.
2. **Embed `<AccessPolicyPanel>`** in the settings page, OR **swap visibility buttons for `<AccessModeSelector>`** in edit modals.
3. **Rewrite sidebar bucketing** using the `bucketForContent` / `isIn*Bucket` helpers from `contentRoles.ts`.
4. **Replace `useSharingDialog().open(...)` with `useAccessPolicyDialog().openFor(...)`**.
5. **Replace `useMyPermission` with `useMyContentRole`** + `roleCan*` helpers.
6. **Delete domain-local `VISIBILITY_ICON` maps**; import `accessModeIcon` from `contentRoles.ts` where needed.

### 2.1 Projects

**`src/ui/src/features/projects/components/settings/GeneralSection.tsx`:**

Delete the "Visibility" section (lines ~154-187) entirely. That concept moves to the new Members section below.

**Create `src/ui/src/features/projects/components/settings/MembersSection.tsx`:**

New file. Structure:

```tsx
import { AccessPolicyPanel } from '@/features/permissions';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';

export function MembersSection({ project }: { project: Project }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2 flex items-center gap-3">
          <Users size={24} weight="duotone" className="text-primary shrink-0" />
          Access & Members
        </h1>
        <p className="text-muted-foreground">Control who can see and edit this project.</p>
      </div>
      <AccessPolicyPanel
        contentType={ContentType.PROJECT}
        contentId={project.id}
        contentTitle={project.name}
        showAuditLink={true}
      />
    </div>
  );
}
```

**Register `MembersSection` in the project settings page.** Find where `GeneralSection` is currently mounted in the settings routes/tabs (likely `features/projects/pages/ProjectSettingsPage.tsx` or similar) and add a new tab/section pointing at `MembersSection`.

**`src/ui/src/features/projects/components/sidebar/ProjectsSidebar.tsx`:**

Lines ~40-47:
```tsx
// OLD:
const filteredProjects = useMemo(() => {
  if (projectScope === "all") return projects;
  if (projectScope === "personal") return projects.filter(p => p.visibility === "PRIVATE");
  return projects.filter(p => p.visibility === "ORGANIZATION");
}, [projects, projectScope]);

// NEW:
import { bucketForContent } from '@/shared/utils/contentRoles';
const currentUserId = useAppSelector(s => s.auth.user?.id ?? '');
const filteredProjects = useMemo(() => {
  if (projectScope === 'all') return projects;
  return projects.filter(p => bucketForContent({
    ownerId: p.ownerId,
    accessMode: p.accessMode,
    currentUserId,
  }) === projectScope);
}, [projects, projectScope, currentUserId]);
```

Line ~122: `project.userPermissionLevel` -> `project.userRole` + `roleCanManage(project.userRole)`.

### 2.2 Notes

**`src/ui/src/features/notes/components/editor/EditorHeader.tsx`:**

- Remove `useSharingDialog` import (line 33).
- Replace with `useAccessPolicyDialog` from `@/features/permissions`.
- The "Share" button (lines ~225, 267) now opens the AccessPolicyDialog via `openFor(ContentType.NOTE, note.id, note.title)`.
- Lines ~36-92 (VisibilityScope references): drop the section-determining switch and just read the note's accessMode + ownerId if needed. Most of this code may become dead weight with the new sidebar bucketing - audit carefully.
- Replace `useMyPermission` with `useMyContentRole(ContentType.NOTE, note.id)` + `roleCanEdit` / `roleCanManage`.

**`src/ui/src/features/notes/components/editor/NotesEditor.tsx`** (line ~12): same `useMyPermission` replacement.

**`src/ui/src/features/notes/pages/NotesPage.tsx`:**

- Remove `SharingDialog` import (line 16) and its render (line ~125). The global `AccessPolicyDialog` mounted in App.tsx handles it.

**`src/ui/src/features/notes/components/sidebar/NotesSidebar.tsx`:**

Lines ~56-68 SECTIONS config:
```ts
const SECTIONS: SectionConfig[] = [
  { id: 'bookmarked',   name: 'Bookmarks',     icon: BookmarkSimpleIcon },
  { id: 'personal',     name: 'Personal',      icon: LockSimple },
  { id: 'shared',       name: 'Shared With Me',icon: UsersThree },
  { id: 'organization', name: 'Organization',  icon: Buildings },
];
// Remove the `scope: VisibilityScope.X` fields - they're unused now.
```

### 2.3 Files

**`src/ui/src/features/files/components/sidebar/FilesSidebar.tsx`:**

- Lines ~41-47 (`handleScopeChange`): unchanged - still dispatches `setViewScope`. The bucketing is applied in the selector.
- Lines ~456-502 (`handleNewFolder`): drop the `VisibilityScope` param. Folders inherit from parent.
- Line ~498: remove `VisibilityScope.PRIVATE` inheritance logic.

**`src/ui/src/features/files/pages/FilesPage.tsx`:**

- Remove `SharingDialog` import (line 19) and render (line ~321).

**`src/ui/src/features/files/components/list/FilesList.tsx`:**

- Remove `VisibilityScope` import (line 63).
- Remove `useSharingDialog` import (line 60).
- Replace all `openSharingDialog(...)` calls (lines 183, 371, 373, 673, 675) with `openFor(...)` from `useAccessPolicyDialog`.

**`src/ui/src/features/files/components/details/FileDetailsPanel.tsx`:**

- Delete `getVisibilityInfo` helper (lines 51-63).
- Delete `useContentPermissions` / `getPermissionLevelLabel` usage (lines 144-148).
- Replace the permissions display with a small embedded summary: either show the `AccessModeSelector` in read-only mode OR render an access-mode label + a "Manage access" button that opens `AccessPolicyDialog`.

**`src/ui/src/features/files/components/upload/UploadDropzone.tsx`:**

Delete the `visibility?: VisibilityScope` prop (lines 13-51). Uploads inherit access from their parent folder/content - no need to pass it from the frontend.

**`src/ui/src/components/editor/utils/imageUploader.ts`, `audioUploader.ts`, `videoUploader.ts`:**

Delete `VisibilityScope` imports (line 14). Remove the hardcoded `VisibilityScope.PRIVATE` on line ~78/79 from the upload request payload. Embedded media inherits from the parent note/canvas on the backend.

### 2.4 Agents

Each of the three views (`AgentsView.tsx`, `ConfigView.tsx`, `PromptsView.tsx`) needs the same treatment:

**Sidebar bucketing:**
```tsx
// OLD:
const VISIBILITY_ICON: Record<number, Icon> = {
  [VisibilityScope.PRIVATE]: LockSimple,
  [VisibilityScope.GROUP]: UsersThree,
  [VisibilityScope.ORGANIZATION]: Buildings,
};

// NEW: delete the map, import accessModeIcon instead.
import { accessModeIcon, bucketForContent } from '@/shared/utils/contentRoles';
```

**Sidebar sections:** rewrite the section-building `useMemo` to use `bucketForContent(agent, currentUserId)`. The "My Agents" / "Shared With Me" / "Organization" labels stay the same.

**PromptsView "move to org" action** (lines ~104-135): currently calls `UpdatePrompt` with `VisibilityScope.ORGANIZATION`. Replace with `dispatch(setContentAccessMode({ contentType: ContentType.PROMPT, contentId: prompt.id, accessMode: AccessMode.OPEN_TO_ORG, baselineRole: ContentRole.VIEWER }))` from `features/permissions`.

**AgentsPage.tsx:**
- Remove `SharingDialog` import (line 7) and render (line ~71).

**AgentsView tabs (InstructionsTab, OverviewTab, SkillsTab, ToolsTab):**
- Replace `useMyPermission` with `useMyContentRole(ContentType.AGENT, agentId)`.

**Agents `ShareButton` usages:** Replace with a button that calls `useAccessPolicyDialog().openFor(ContentType.AGENT, agent.id, agent.name)`.

### 2.5 Calendar

**`EventEditor.tsx`, `QuickEventModal.tsx`, `CreateTemplateModal.tsx`:**

Keep the local `useState<'private' | 'organization'>` - the serialization layer handles the mapping. Just make sure the import of `VisibilityScope` is gone and no hardcoded `VisibilityScope.X` remains.

For `CreateTemplateModal.tsx` line ~90: the hardcoded `VisibilityScope.PRIVATE` is already going via `calendarThunks`, which now translates it. If the modal sends raw proto, update it to send `'private'`.

**`useCalendarEvents.ts`** lines ~58-69: unchanged (uses the frontend facade string).

### 2.6 Rooms

**`src/ui/src/features/rooms/components/modals/RoomFormModal.tsx`** (lines ~40-43, 73):

Keep the `'private' | 'organization'` `<Select>` - unchanged at the UI level. The serialization happens in `roomsThunks.ts`.

### 2.7 Admin permissions page

**`src/ui/src/features/admin/components/permissions/PermissionDefaultsSection.tsx`:**

Full rewrite. The new page shows, per content type:

```
NOTE                    [NotePencil icon]
Default access mode:
  (o) Only owner
  ( ) Invited people only
  ( ) Everyone in org
      Baseline role: [Viewer v]
Updated 2 days ago
```

Use the `AccessModeSelector` component directly. The per-content-type card calls `dispatch(updatePermissionDefaults({ contentType, defaultAccessMode, defaultBaselineRole }))` on change.

Delete the 4 `PermissionToggle` switches. Delete the `membersCan*` logic in `ContentTypeCard`.

Preserve the grid layout, the section header, the loading state, and the error banner.

### 2.8 App.tsx - mount the dialog provider

In `src/ui/src/App.tsx` (or wherever global providers live), wrap the authenticated routes with `<AccessPolicyDialogProvider>` and render `<AccessPolicyDialog />` at the same level as the existing global modals.

**Phase 2 verification:** After all domains are done, `rg "VisibilityScope" src/ui/src` and `rg "PermissionLevel" src/ui/src` should return zero matches (except maybe in comments explaining the migration - those are fine to remove too). `rg "features/sharing" src/ui/src` should also return zero matches.

---

## Phase 3 - Logout / org-switch cleanup

Goal: wire the new `clearPermissions` action into the auth lifecycle.

### 3.1 `src/ui/src/components/layout/UserMenu.tsx` (line 21)

Replace `clearSharing` with `clearPermissions` in the logout handler. Import from `@/features/permissions`.

### 3.2 `src/ui/src/features/auth/components/OrganizationPicker.tsx` (line 16)

Replace `clearSharing` with `clearPermissions` in the org-switch handler.

Also audit any other cleanup dispatches (e.g. the `handleLogout` example in `docs/agents/frontend.md` shows the pattern). The new cleanup list should drop `clearSharing` and add `clearPermissions`.

---

## Phase 4 - Redux store wire-up + delete sharing feature (atomic)

Goal: this phase is the point of no return. After this, the old `features/sharing/` directory is gone and the store has the new reducer.

**Do this as one commit.** All prior phases must be complete and the tree must compile. Run `./run.sh lint-frontend` before starting this phase - it should only be failing on the leftover sharing references (which this phase removes).

### 4.1 Update `src/ui/src/app/store.ts`

Line 13:
```ts
// REMOVE:
import { sharingReducer } from '@/features/sharing/store/sharingSlice';
// ADD:
import { permissionsReducer } from '@/features/permissions';
```

Line 163 in `combineReducers`:
```ts
// REMOVE:
sharing: sharingReducer,
// ADD:
permissions: permissionsReducer,
```

### 4.2 Delete the sharing feature

```
rm -rf src/ui/src/features/sharing/
```

Files:
- `api/sharingApi.ts`
- `components/SharingDialog.tsx`, `ShareButton.tsx`, `PermissionRow.tsx`, `PermissionLevelSelect.tsx`, `ShareTargetSearch.tsx`
- `hooks/useSharingHooks.ts`
- `store/sharingSlice.ts`, `sharingThunks.ts`
- `index.ts`

### 4.3 Final scrub

```bash
rg "features/sharing" src/ui/src                              # expect 0
rg "useSharingDialog\|useContentPermissions\|useMyPermission" src/ui/src  # expect 0
rg "SerializedShareTarget\|shareTargetToSubject" src/ui/src   # expect 0
rg "VisibilityScope" src/ui/src                               # expect 0
rg "PermissionLevel" src/ui/src                               # expect 0
rg "userPermissionLevel" src/ui/src                           # expect 0
rg "membersCanView\|membersCanEdit\|membersCanDelete\|membersCanShare" src/ui/src  # expect 0
```

Fix any stragglers.

---

## Phase 5 - Audit log UI (targeted)

Goal: wire `AuditLogPanel` into the places the spec calls out as highest-value.

### 5.1 Project settings - "Access history" tab

Add a new tab to the project settings page alongside `MembersSection`. Renders `<AuditLogPanel contentType={ContentType.PROJECT} contentId={project.id} />`.

Alternatively embed it as a section inside `MembersSection` below the members list - either works. Decide based on existing project settings layout.

### 5.2 Notes - link from AccessPolicyDialog

Lower priority. The `AccessPolicyPanel` already exposes a "View access history" link when `showAuditLink` is true. That's enough for notes in this phase.

Other domains (files, calendar, agents, rooms) get audit UI as a follow-up if needed.

---

## Phase 6 - Verification

### 6.1 Compilation + lint

```bash
./run.sh lint-frontend           # must be clean
./run.sh test-frontend           # must be clean (any broken tests fixed)
```

### 6.2 Grep verification

All must return zero matches:

```bash
rg "VisibilityScope" src/ui/src
rg "PermissionLevel" src/ui/src
rg "features/sharing" src/ui/src
rg "useSharingDialog" src/ui/src
rg "useContentPermissions" src/ui/src
rg "useMyPermission" src/ui/src
rg "userPermissionLevel" src/ui/src
rg "membersCanView|membersCanEdit|membersCanDelete|membersCanShare" src/ui/src
rg "SerializedShareTarget|shareTargetToSubject|subjectToShareTarget" src/ui/src
rg "organizeNotesByVisibility" src/ui/src     # should be zero; rename verified
rg "GroupTreeSection" src/ui/src              # should be zero
```

### 6.3 Manual smoke test

Start backend + frontend:
```bash
./run.sh dev
```

Walk through each content type:

**Projects:**
1. Create a new project (defaults to `OPEN_TO_ORG / EDITOR` per backend defaults).
2. Open project settings -> Access & Members.
3. Switch to `EXPLICIT_MEMBERS`, verify warning/confirmation UX.
4. Add a second user as Commenter via `AddMemberPopover`.
5. Add a group as Editor.
6. Block a third user; open the app as that user, confirm the project does not appear in list.
7. Transfer ownership to another user; verify previous owner becomes Admin in the members list.
8. Open "Access history" tab; verify all 6 action types appear with correct actors and relative times.

**Notes, Files, Calendar, Agents, Rooms:** Same basic flow. Confirm:
- Sidebar shows the 3 buckets (Personal / Shared with me / Organization) and items appear in the right section.
- "Share" button opens `AccessPolicyDialog` with working add/update/remove + access mode selector.
- Org-admin user sees BLOCKED content (bypass working).

**Admin permissions page** (`/admin/permissions`):
- Each content type card shows the current access mode + baseline role.
- Changing the access mode on a card saves and reflects on page reload.

### 6.4 Responsive check

Test at 375px (mobile), 768px (tablet portrait), 1024px (tablet landscape), and full desktop:
- `AccessPolicyDialog` renders as a bottom sheet on mobile (`items-end sm:items-center`, `rounded-t-xl sm:rounded-xl`).
- `AccessPolicyPanel` inside project settings stacks correctly on narrow viewports.
- `AddMemberPopover` search dropdown does not clip off-screen on mobile.

### 6.5 Zen mode check

Toggle `Ctrl+\` on any domain page:
- Sidebars hide.
- Content area fills available space.
- `AccessPolicyDialog` still openable and usable.

---

## File manifest summary

### New files
```
src/ui/src/shared/utils/contentRoles.ts
src/ui/src/features/permissions/api/membersApi.ts
src/ui/src/features/permissions/store/permissionsSlice.ts
src/ui/src/features/permissions/store/permissionsThunks.ts
src/ui/src/features/permissions/hooks/useContentMembers.ts
src/ui/src/features/permissions/hooks/useContentAuditLog.ts
src/ui/src/features/permissions/hooks/useMyContentRole.ts
src/ui/src/features/permissions/components/AccessPolicyPanel.tsx
src/ui/src/features/permissions/components/AccessPolicyDialog.tsx
src/ui/src/features/permissions/components/AccessModeSelector.tsx
src/ui/src/features/permissions/components/ContentRoleBadge.tsx
src/ui/src/features/permissions/components/ContentRoleSelect.tsx
src/ui/src/features/permissions/components/MemberRow.tsx
src/ui/src/features/permissions/components/AddMemberPopover.tsx
src/ui/src/features/permissions/components/BlockedMembersSection.tsx
src/ui/src/features/permissions/components/AuditLogPanel.tsx
src/ui/src/features/permissions/index.ts
src/ui/src/features/projects/components/settings/MembersSection.tsx
```

### Deleted files
```
src/ui/src/features/sharing/              (entire directory, 10+ files)
```

### Modified files (partial; per-file detail above in each phase)

```
src/ui/src/App.tsx                                         # mount AccessPolicyDialogProvider + dialog
src/ui/src/app/store.ts                                    # swap sharingReducer -> permissionsReducer
src/ui/src/components/layout/UserMenu.tsx                  # clearPermissions on logout
src/ui/src/components/subject/hooks/useSubjectSearch.ts    # rewrite off sharing slice
src/ui/src/components/subject/utils.ts                    # drop ShareTarget converters
src/ui/src/components/editor/utils/imageUploader.ts        # drop visibility hardcode
src/ui/src/components/editor/utils/audioUploader.ts        # drop visibility hardcode
src/ui/src/components/editor/utils/videoUploader.ts        # drop visibility hardcode

src/ui/src/features/auth/components/OrganizationPicker.tsx # clearPermissions on org switch

src/ui/src/features/admin/store/adminSlice.ts              # SerializedContentTypeDefaults shape
src/ui/src/features/admin/store/adminThunks.ts             # updatePermissionDefaults payload
src/ui/src/features/admin/hooks/useAdminHooks.ts           # drop VisibilityScope refs
src/ui/src/features/admin/components/permissions/PermissionDefaultsSection.tsx  # full rewrite

src/ui/src/features/projects/types/project.ts              # new shape
src/ui/src/features/projects/api/projectsApi.ts            # serialization rewrite
src/ui/src/features/projects/store/projectsThunks.ts       # drop visibility params
src/ui/src/features/projects/hooks/useProjectPermissions.ts # role-based gating
src/ui/src/features/projects/components/CreateProjectModal.tsx  # seed accessMode from scope
src/ui/src/features/projects/components/settings/GeneralSection.tsx  # drop visibility section
src/ui/src/features/projects/components/sidebar/ProjectsSidebar.tsx  # bucketForContent

src/ui/src/features/notes/store/notesThunks.ts             # noteToPlain + thunks
src/ui/src/features/notes/store/notesSlice.ts              # drop visibility refs
src/ui/src/features/notes/store/notesTreeSlice.ts          # bucketing + drop GroupTreeSection
src/ui/src/features/notes/utils/notesTreeUtils.ts          # organizeNotesBySection rename + rewrite
src/ui/src/features/notes/components/editor/EditorHeader.tsx   # useAccessPolicyDialog + useMyContentRole
src/ui/src/features/notes/components/editor/NotesEditor.tsx    # useMyContentRole
src/ui/src/features/notes/components/sidebar/NotesSidebar.tsx  # SECTIONS config
src/ui/src/features/notes/pages/NotesPage.tsx              # drop SharingDialog

src/ui/src/features/files/store/filesThunks.ts             # fileToPlain + thunks
src/ui/src/features/files/store/filesSlice.ts              # drop visibility filters
src/ui/src/features/files/store/filesTreeSlice.ts          # bucketing in reducer
src/ui/src/features/files/store/filesTreeThunks.ts         # drop visibility params
src/ui/src/features/files/store/selectors.ts               # rewrite selectFilesForCurrentFolderAndScope
src/ui/src/features/files/store/savedFiltersSlice.ts       # drop visibility field
src/ui/src/features/files/store/uploadSlice.ts             # drop visibility field
src/ui/src/features/files/store/viewerThunks.ts            # userPermissionLevel -> userRole
src/ui/src/features/files/hooks/useUploadProcessor.ts      # same
src/ui/src/features/files/components/sidebar/FilesSidebar.tsx  # drop visibility param
src/ui/src/features/files/components/list/FilesList.tsx    # useAccessPolicyDialog
src/ui/src/features/files/components/details/FileDetailsPanel.tsx  # full rewrite
src/ui/src/features/files/components/upload/UploadDropzone.tsx  # drop visibility prop
src/ui/src/features/files/pages/FilesPage.tsx              # drop SharingDialog

src/ui/src/features/agents/store/agentsSlice.ts            # drop visibility refs
src/ui/src/features/agents/store/*.ts (other slices)       # same
src/ui/src/features/agents/components/views/AgentsView.tsx # bucketing rewrite
src/ui/src/features/agents/components/views/ConfigView.tsx # same
src/ui/src/features/agents/components/views/PromptsView.tsx # same + move-to-org via MembersService
src/ui/src/features/agents/components/views/AgentsView/InstructionsTab.tsx  # useMyContentRole
src/ui/src/features/agents/components/views/AgentsView/OverviewTab.tsx      # useMyContentRole
src/ui/src/features/agents/components/views/AgentsView/SkillsTab.tsx        # useMyContentRole
src/ui/src/features/agents/components/views/AgentsView/ToolsTab.tsx         # useMyContentRole
src/ui/src/features/agents/pages/AgentsPage.tsx            # drop SharingDialog

src/ui/src/features/calendar/store/calendarThunks.ts       # frontendVisibilityToAccessMode map
src/ui/src/features/calendar/components/modals/EventEditor.tsx          # drop proto imports
src/ui/src/features/calendar/components/modals/QuickEventModal.tsx      # same
src/ui/src/features/calendar/components/modals/CreateTemplateModal.tsx  # same

src/ui/src/features/rooms/store/roomsThunks.ts             # frontendVisibilityToAccessMode map
```

Total modified: approximately 50 files. Total new: 18. Total deleted: 10+.

---

## Critical reminders for Sonnet

1. **No default exports anywhere.** All new files use named exports. Check the `MEMORY.md` feedback - this is enforced.
2. **Absolute imports only.** `@/...` never `../...`. Enforced by lint.
3. **No decorative comments.** No `// ----` dividers, no section-label comments like `// Helpers`, `// Actions`. The linter/user removes these on sight.
4. **No manual `toast.error()`.** Use `rejectWithValue(err.message)` in thunks; `errorToastMiddleware` handles display.
5. **Responsive design is required.** Every new component must support mobile (375px), tablet (768/1024px), and desktop. Use `useBreakpoint()` where behavior differs.
6. **Zen mode.** Settings pages and modals must still work when `state.zenMode.isActive`.
7. **No emojis in code, comments, or docs.**
8. **No hyphens in emoji form; single hyphens only in prose.**
9. **Lazy loading.** New pages (if any) must use `lazyImport` + `<LazyRoute>` - but this plan does not add new routes, only modifies existing ones.
10. **Check barrel files when deleting exports.** Multiple `features/*/index.ts` files may re-export things that are being removed. See MEMORY.md "Gotcha: Barrel Re-exports".
11. **Do not do meta documentation in source files.** Module-level docstrings stay one line. Class docstrings stay one sentence. This plan document holds all the context; source files hold just the code.
12. **BigInt serialization.** Timestamps come from proto as `{ seconds: bigint, nanos: number }`. Serialize as `{ seconds: string, nanos: number }` for Redux (bigint is not serializable).

---

## When things go wrong

If `./run.sh lint-frontend` fails with obscure errors after Phase 4:

1. **`Cannot find module '@/features/sharing/...'`** - you missed a consumer. Run the scrub grep commands in Phase 4.3 to find it.
2. **`Property 'visibility' does not exist on type 'Project'`** - Phase 1.6 was incomplete. Go back and finish the type/api rewrite for that domain.
3. **`state.sharing.*` errors at runtime** - the store rehydrated a persisted state from before the redesign. Wipe `localStorage` in the browser devtools (or bump the persistConfig version and add a migration that strips `sharing` from state).
4. **Circular import errors** - usually means `features/permissions/index.ts` is importing from a file that imports from `features/permissions/index.ts`. Use direct file imports inside the feature module; only external consumers use the barrel.

If a domain's tests fail after Phase 2:
- Most likely the test uses a hand-crafted `SerializedProject` / `SerializedNote` that still has `visibility` or `userPermissionLevel`. Update the test fixtures.

If the audit log shows wrong actor names:
- `AuditLogPanel` uses `useSubjectResolver`. If an actor is a deleted user, the resolver should return a "Former member" fallback (see frontend.md section 1.10a). Verify that fallback exists; add it if missing.

---

## Phase progress tracker

Sonnet should update this section as it goes. Mark `[x]` when a phase is fully complete and committed.

- [ ] Phase 0 - `contentRoles.ts` shared helper
- [ ] Phase 1 - `features/permissions/` feature scaffolded and isolated
- [ ] Phase 1.5 - Subject search decoupled from sharing slice
- [ ] Phase 1.6.1 - Projects serialization rewrite
- [ ] Phase 1.6.2 - Notes serialization rewrite
- [ ] Phase 1.6.3 - Files serialization rewrite
- [ ] Phase 1.6.4 - Agents serialization rewrite (all 4 sub-domains)
- [ ] Phase 1.6.5 - Calendar serialization rewrite
- [ ] Phase 1.6.6 - Rooms serialization rewrite
- [ ] Phase 1.6.7 - Admin slice rewrite
- [ ] Phase 2.1 - Projects UI (MembersSection + sidebar + settings)
- [ ] Phase 2.2 - Notes UI (editor + sidebar + pages)
- [ ] Phase 2.3 - Files UI (sidebar + list + details + upload)
- [ ] Phase 2.4 - Agents UI (3 views + tabs + pages)
- [ ] Phase 2.5 - Calendar UI (3 modals)
- [ ] Phase 2.6 - Rooms UI (form modal)
- [ ] Phase 2.7 - Admin permissions page rewrite
- [ ] Phase 2.8 - App.tsx provider mount
- [ ] Phase 3 - Logout/org-switch cleanup
- [ ] Phase 4 - Store wire-up + delete sharing feature (atomic)
- [ ] Phase 5 - Audit log UI in project settings
- [ ] Phase 6 - Full verification (lint, test, grep, manual smoke, responsive, zen mode)
