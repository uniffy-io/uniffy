---
paths:
  - "src/ui/src/components/mention/**/*.ts"
  - "src/ui/src/components/mention/**/*.tsx"
  - "src/ui/src/components/editor/plugins/mention/**/*.ts"
  - "src/ui/src/components/editor/plugins/mention/**/*.tsx"
  - "src/uniffy/domains/search/**/*.py"
  - "src/uniffy/core/search/**/*.py"
  - "src/uniffy/core/content/base_operations.py"
  - "src/uniffy/core/valkey/mentions.py"
  - "src/proto/search/v1/search.proto"
---

# Mention Chips

Universal `@`-mentions are first-class citizens in Uniffy. Anywhere a user can type Markdown they can drop a URN reference and the chip renders a live, type-aware preview of the target. The chip stays in sync with the underlying content for as long as it is visible.

This rule defines the architecture so changes here stay coherent. **Reading the whole file before editing anything under the paths above tends to save rework.**

---

## The contract

Every mention chip satisfies these properties:

1. **Live**: when the referenced content changes (rename, status flip, member add, folder rename, …) every visible chip pointing to it updates without a page refresh.
2. **Availability-safe**: an existing inaccessible target renders Restricted, a confirmed deleted target renders a tombstone, and an uncertain lookup renders Unavailable. Authorization failure and deletion are never conflated.
3. **Index-first reads**: Meilisearch supplies normal display data and both permission-filtered and raw existence checks. A successful raw-index miss may use the registered PostgreSQL reference-state loader only to classify live/deleted/missing; that fallback never supplies title, description, URL, owner, or metadata.
4. **Same component everywhere, setting-driven default**: one chip component renders in chat messages, search results, comments, and the note editor, and the user's `mentionDisplay` setting decides pill vs card uniformly. A mid-sentence expanded card breaks out as a block that splits the line boxes (editor CSS owns that); it never renders as an inline island.
5. **Stable size**: a chip in expanded mode reserves the expanded-card footprint immediately (skeleton). Growing from inline-pill to block-card after the fetch lands tends to feel janky.

If a change you are about to make breaks one of these, it is a good moment to reconsider the design.

---

## Three-layer flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  Domain mutation (note.update / channel.update / task.update / …)   │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
┌───────────────┐            ┌──────────────────────┐
│ Re-index doc  │            │  publish_mention_    │
│ (Meilisearch) │            │  state (Valkey       │
│ -- write-time │            │  pubsub)             │
│ denormalized  │            │  -- partial patch    │
│ metadata      │            │  for visible chips   │
└───────┬───────┘            └──────────┬───────────┘
        │                               │
        │  (read-time)                  │  (stream)
        ▼                               ▼
┌──────────────────────────┐   ┌──────────────────────────────┐
│ search.ResolveUrns RPC   │   │ notifications.StreamNotifi-  │
│ -> Meili.get_documents   │   │ cations -> MENTION_STATE_    │
│ -> proto UrnMetadata     │   │ CHANGED event                │
└──────────┬───────────────┘   └──────────┬───────────────────┘
           │                              │
           ▼                              ▼
        Frontend MentionStateProvider (or module emitter)
                          │
                          ▼
                    MentionChip render
```

The two delivery paths (RPC + stream) feed the same `MentionLiveState` shape on the frontend. The RPC path is for first-paint resolution; the stream path is for in-place updates.

---

## Backend rules

### Index-time denormalization (mandatory)

Every domain whose content can be `@`-mentioned extends `BaseContentOperations` and writes to the search index through `_index_for_search`. The base method calls `_get_search_metadata_async(model)` to assemble the metadata dict that lands in Meilisearch.

**The metadata dict is the canonical source for live-state fields.** Anything a chip needs to render goes here.

| Hook | Purpose |
|------|---------|
| `_get_search_title(model)` | Document `title` |
| `_get_search_description(model)` | Snippet shown in the expanded card body. Strip Markdown / mention syntax before slicing - raw `[[[label\|urn]]]` syntax in the index renders incorrectly downstream. |
| `_get_search_tags(model)` | Tags array |
| `_get_search_metadata(model)` | Sync hook: cheap-to-compute fields that need no DB lookup (e.g. `mime_type`). |
| `_get_search_metadata_async(model)` | Async hook for fields that require a session (parent folder name, category title, member count). Default delegates to the sync version. |

Use snake_case keys (`parent_label`, `member_count`, `processing_status`). The frontend translation layer expects this.

### Re-index on every state mutation

If a field appears in the index document, every code path that changes it re-indexes. This includes:

- The model's own `create` / `update` / `restore` / `autosave`
- Child propagation: a folder rename re-indexes every direct child; a category rename re-indexes every channel in the category.
- Any bulk path (`empty_trash`, batch member add) - snapshot affected ids before the mutation, re-index after the commit.

Skipping this step leaves the chip with stale data. The user will notice. Cache invalidation is not a substitute.

### The label slot is sanitized, never raw

`[[[label|urn]]]` is built by string interpolation on all three platforms, so **every writer routes the
label through the sanitizer**: `sanitize_mention_label` (`core/content/references.py`),
`sanitizeMentionLabel` (`@/shared/utils/mentionUtils`), `sanitizeMentionLabel`
(`@shared/mentions/mentionLabel` on mobile). It strips `[ ] | \`, collapses whitespace, and falls back
to `mention`. Without it a title like `X|urn:uniffy:content:USER:<id>]]] approved [[[Y` mints a mention
of a user its author never referenced - and the rename fanout (`replace_mention_label`) writes that into
*other people's* documents, so the sanitize call inside it is load-bearing rather than defensive.

Stripping is lossless for readers: the label is display fallback only, since a live chip renders
`liveState.title || label` from the resolved document. Titles keep their `|` and `[` everywhere else.

The parse side matches: every mention regex on every platform uses `[^[\]|]` for the label group, so raw
markup carrying structural characters renders as visible plain text instead of silently restructuring.
A new writer that interpolates a label without the sanitizer reopens this.

### Live updates: `publish_mention_state`

Re-indexing alone is not enough - already-rendered chips do not poll. After every re-index call `publish_mention_state(organization_id, urn, changes)` to push the patch to subscribers.

Conventions:

- The `changes` payload is a `dict[str, str]` with snake_case keys - same shape as the index metadata, plus virtual keys `title`, `description`, `urn_status`.
- Send the **full** denormalized payload rather than a diff. Diffing across callers tends to be fragile; the payload is small.
- The publish call is idempotent - safe to retry, safe to no-op when there are no listeners (Valkey-down case).

### Resolve path and privacy boundary

`SearchOperations.resolve_urns` is the public read path. It:

1. Runs a permission-filtered Meilisearch multi-get. Hits are `AVAILABLE` and may carry display metadata.
2. Runs an organization-scoped raw Meilisearch multi-get only for filtered misses. A raw hit proves existence and becomes `RESTRICTED`; every private display field is discarded before conversion.
3. For a successful raw miss only, runs the registered, batched PostgreSQL reference-state loader. Confirmed deleted/missing rows become `DELETED`; live rows absent from the index become `UNAVAILABLE` so indexing lag is not misreported as deletion.
4. Any failed or incomplete Meilisearch chunk becomes `UNAVAILABLE`. A service failure never becomes `RESTRICTED` or `DELETED`.
5. Returns one typed result per valid input URN; silent drops are a bug.

Active organization membership is required before either index pass. Raw lookups remain scoped to `organization_id`, and restricted results expose only the requested URN, its type, `availability`, and `can_request_access`. The label shown by React comes from the already-readable Markdown reference, not from the raw search document.

`core/content/reference_state.py` is the only sanctioned database fallback for availability classification. Register bounded, organization-scoped loaders there. Do not add display hydration to the fallback or return raw index fields for restricted results. New display fields still belong in the search document at write time.

### Cascade-removal on parent delete

Deleting a parent must cascade through every child that lives in the search index. Otherwise global search keeps surfacing orphans that point to a target the user can no longer open, and mention chips render valid-looking previews for content that is gone.

Two patterns:

| Shape | Where to wire | How |
|-------|---------------|-----|
| Per-row remove during bulk traversal | The recursive helper that mutates children (e.g. `FolderOperations._delete_contents`, `NoteOperations._collect_descendant_ids`) | Loop and call `SearchIndexer.remove(build_content_urn(type, id))` per child. |
| Filter-based bulk drop | Single-shot helper at the top-level delete (e.g. `ChatChannelOperations.delete_channel`, `ProjectOperations.delete`) | `SearchIndexer.remove_by_filter(filter_expr)` against a filterable metadata field. |

The filter approach requires the child to carry a parent id in its search metadata **and** that field be declared in `filterable_attributes` (`core/search/meilisearch.py`). Today: `metadata.channel_id` (chat messages), `metadata.project_id` (tasks), `metadata.folder_id` (files).

When you add a new parent/child relationship that reaches search, add the parent id to the child's `_get_search_metadata` and to the filterable list, then wire the cascade. Skipping the cascade is the default failure mode - the index keeps growing and "deleted" content stays searchable.

### Availability and requestability

`UrnAvailability` has four states:

| State | Meaning | UI behavior |
|---|---|---|
| `AVAILABLE` | Permission-filtered index hit | Normal live chip, preview, navigation, and expansion. |
| `RESTRICTED` | Raw same-org index hit after a filtered miss | Lock chip using only the stored Markdown label; no preview or navigation. |
| `DELETED` | Registered authoritative loader reports deleted/missing | Privacy-safe type-only tombstone with no recovery action. |
| `UNAVAILABLE` | Index failure, live row absent from the index, or unregistered authoritative state | Non-navigable retry state; never a tombstone. |

`can_request_access` is computed from the raw document type and policy shape without exposing either. Requestable restricted chips open the persisted permissions access-request workflow. Requests for tasks canonicalize to their project; requests for private chat messages canonicalize to their channel. Unsupported types stay restricted without an action.

Access-request ids, state, and cooldown timestamps are not search metadata. The frontend batches them through `GetMyAccessRequestStatuses` after restricted resolution and merges `ACCESS_REQUEST_CHANGED` stream events into the shared mention cache. Approval force-resolves the original URN with bounded retries so asynchronous child ACL propagation can finish.

To mark a URN as DELETED for visible chips in real time: emit `publish_mention_state(..., changes={"urn_status": "DELETED"})` from your `delete()` path **and** call `SearchIndexer.remove`.

---

## Frontend rules

### Single source of truth: `MentionLiveState`

`src/ui/src/components/mention/types.ts` defines the typed shape every chip consumer reads. Generic fields (`title`, `description`, `parentLabel`, `status`) live at the top; type-specific groups follow. **Reading raw metadata dict keys from a render component tends to break silently** - if you need a new field, add it to `MentionLiveState` and wire the translator.

### Two translators, one shape

Live state arrives in three encodings; we have a translator for each:

| Source | Encoding | Translator | File |
|--------|----------|-----------|------|
| `searchApi.resolveUrns` (typed RPC) | `UrnMetadata` proto | `metadataToLiveState(urn, meta)` | `MentionStateProvider.tsx` |
| `useBatchedSubjectResolver` (preview cache) | `UrnPreviewData` (subset) | `previewDataToLiveState(urn, data)` | `useBatchedSubjectResolver.ts` |
| `MENTION_STATE_CHANGED` stream event | `Record<string, string>` (snake_case) | `streamChangesToLiveState(changes)` | `MentionStateProvider.tsx` |

When you add a new field, update **all three** translators. They drift in proportion to how easy it is to forget one.

### Two providers, one cache

| Component | Where it mounts | Behaviour |
|-----------|-----------------|-----------|
| `MentionStateProvider` | `MainLayout` (one per app tree) | Real `register` / `unregister`, batches via `searchApi.resolveUrns`, listens to the stream, writes through to the module-level emitter. |
| `MentionDisplayBridge` | Each ProseMirror NodeView (per-chip React root in the editor) | Provides the `mentionDisplay` setting; `register` / `unregister` are noops. State arrives through the module-level emitter only. |

Outside the main React tree (editor NodeViews), `useMentionState` detects the absent provider and triggers `resolveUrnBatched` itself. The flush calls `publishMentionState`, the emitter wakes up the listening chip. **A second resolver tends to fragment the cache** - the global batch resolver is the one shared cache.

### Module-level emitter

`mentionStateEmitter.ts` exposes:

| API | Purpose |
|-----|---------|
| `getMentionState(urn)` | Sync read (used by ProseMirror NodeViews and `useState` initializers). |
| `setMentionState(urn, state)` | Silent write. Use only when a parent listener will fire setStates explicitly. |
| `publishMentionState(urn, state)` | Write **and** broadcast to every `onMentionStateChange` listener. Default tool. |
| `onMentionStateChange(cb)` | Subscribe (returns unsubscribe). |
| `emitMentionStateChange(urn, changes)` | Direct broadcast (used from the notification stream). |

If your code resolves a URN outside the main provider, finish with `publishMentionState` so editor chips wake up.

### Stream merge: snake_case translation is mandatory

Stream payloads arrive as proto `map<string, string>` - snake_case keys, string values. **Spreading the raw dict into `MentionLiveState` silently fails**: chip components read camelCase fields, the merge does not match, the live update never lands. Run the dict through `streamChangesToLiveState` first.

If you publish a new key from the backend, add a `case` to `streamChangesToLiveState`. Without it the patch is dropped on the floor.

### Component tree

```
MentionChip          (full chip; hover preview, expand button, live state)
├─ MentionExpandedCard       (block-level rich card; routes to per-type preview)
│  ├─ TaskMentionPreview
│  ├─ NoteMentionPreview
│  ├─ FileMentionPreview
│  ├─ FolderMentionPreview
│  ├─ RoomMentionPreview
│  ├─ ChatMentionPreview
│  ├─ CalendarMentionPreview
│  ├─ ProjectMentionPreview
│  └─ AgentMentionPreview
├─ MentionExpandedCardSkeleton  (loading footprint, prevents size jump)
├─ MentionRestricted            (privacy-safe lock state and request action)
├─ MentionUnavailable           (non-final retry state)
├─ MentionTombstoneChip / MentionTombstoneCard  (deleted state)
└─ MentionPreview (hover popover; attaches on every chip type - the expand caret suppresses it.
   USER routes to the shared PersonCardContent instead of the content-preview shell; see below)

MentionChipCompact   (dense inline pill; same data, smaller)
```

**People tokens:** `USER`, `AGENT`, and `TEAM` do not render as boxed chips. All three variants render them as a Slack-style `@Name` text token, composed from `peopleTokenClasses` + `PEOPLE_TOKEN_TYPES` in `mentionConstants.ts` (every surface reuses that helper - hand-copied class strings drift): one accent for every subject kind (`text-primary` on `bg-primary/10`, `bg-primary/25` when the mentioned user IS the viewer; the compose static chip renders without viewer context, so it never applies the self-mention wash), baseline-aligned, no border, no avatar, no presence. Avatars, presence, the agent badge, and member counts live in the hover card only. Teams get the people treatment because a team mention notifies its members - it behaves like a people mention, so it reads like one.

**One person card everywhere.** Hovering a USER token opens `PersonHoverCard` / `PersonCardContent` (`src/ui/src/components/subject/PersonHoverCard.tsx`) - the same card the chat sender name and the org chart open. There is exactly one person hover card in the app; a surface that needs a person popover mounts this one instead of hand-rolling markup. The card merges two sources: the people-store profile snapshot (`fetchPersonThunk` - pronouns, phones, office, bio, teams with lead badges, the fields Meili does not carry) and the USER mention live state via `useMentionState` on the canonical `urn:uniffy:content:USER:{id}` key, so display name, job title, department, team, email, and timezone changes stream into an open card through `MENTION_STATE_CHANGED` without a refetch. The profile RPC on hover is a sanctioned index-first exception because people profiles are org-readable member-record data (see `permissions.md`); the live fields still ride the index, so the USER metadata keys and their three translator entries stay load-bearing. Mobile mirrors the contract with `MentionToken` (`src/mobile/src/shared/mentions/MentionToken.tsx`, composed by `MarkdownRenderer`): same three kinds, same single accent, self-mention wash from the signed-in user; GROUP stays a boxed chip on both platforms, and chat SYSTEM messages keep their capsule rendering with plain emphasized names.

**Expandable types** (may render the block card): `TASK`, `CALENDAR_EVENT`, `PROJECT`, `FILE`, `FOLDER`, `NOTE`, `CHAT`, `CHAT_MESSAGE`, `TAG`, `ROOM`. See `mentionConstants.ts`. Other non-token types render as inline pills with a hover popover.

**Container stats are index metadata, live like everything else.** File folders carry `file_count` / `folder_count` / `total_size` (direct children only - recursive totals would turn deep mutations into subtree walks); every child create/delete/restore/move calls `FolderOperations.refresh_folder_stats`, which re-indexes and publishes the full payload. Trash purges (`empty_trash`) deliberately do NOT refresh: trashed rows are already excluded from the counts. Folder-type notes carry `child_count` the same way via `NoteOperations._refresh_parent_folder`. Rooms carry `room_type` / `capacity` / `building` / `floor` / `location` / `amenities` (pre-joined display string, capped at 4).

The user's `mentionDisplay` setting (`expanded` / `compact`) controls the default everywhere. Per-chip toggles persist in `localStorage` under `mention-toggle:{surface}:{urn}` (surface = first route segment: chat, notes, calendar, ...) and win over the setting within that surface only - collapsing a chip in chat never collapses the same URN in a note.

### Consistent placement

The expanded card header has a fixed slot order in its meta row:

```
[icon-badge]  TITLE
              📁 ParentLabel  ·  TypeLabel  ·  TypeMeta1  ·  TypeMeta2 …
```

`ParentLabel` (folder / category / parent note) is always **first** in the meta row, rendered via the shared `<ParentBadge>` component (`previews/ParentBadge.tsx`). `<MetaSeparator>` is the canonical middle-dot. Rolling your own breadcrumb here tends to fragment the visual language - it is the bug we keep cleaning up.

When you add a new mention type or extend an existing preview, place new metadata to the **right** of the existing row rather than inside it.

### Availability rendering

`MentionLiveState.availability` short-circuits before people tokens, previews, expansion, navigation, embedding, and live indicators. Restricted variants render the Markdown fallback label and a real descendant button that opens the global Redux request dialog. Unavailable variants render Retry. Deleted variants render `MentionTombstoneChip` or `MentionTombstoneCard` and intentionally discard the stored label.

Recovery or re-fetch of a tombstone is not part of the contract. The state is final.

---

## Adding a new live-state field

Concrete checklist when, e.g., adding `assignee_count` to project mentions:

1. **Backend write path**:
   - Add `"assignee_count"` to the project's `_get_search_metadata_async` (or the chat-style override).
   - Add the same key to every `publish_mention_state` payload that runs after a mutation that could change it.
   - Re-index every project in a backfill job (write a one-off `uv run` script if needed).

2. **Frontend type**:
   - Add `projectAssigneeCount?: number` to `MentionLiveState`.

3. **Frontend translators (all three!)**:
   - `metadataToLiveState`: parse `m['assignee_count']` -> `state.projectAssigneeCount`.
   - `previewDataToLiveState`: same parse.
   - `streamChangesToLiveState`: add `case 'assignee_count':` -> `patch.projectAssigneeCount`.

4. **Render**: add the field to `ProjectMentionPreview` in the meta row, after ParentLabel.

5. **Test**: type the mention, change the underlying state, watch the chip update without refresh. If you need a refresh, you missed step 1 (publish) or step 3 (translator).

---

## Anti-patterns (worth a second look before committing)

- Database display hydration in the reference-state fallback. It may classify registered ids only; it must not return content fields.
- Treating a filtered or raw Meilisearch failure as a miss. Incomplete chunks are `UNAVAILABLE`.
- Putting access-request status into search metadata. It is requester-specific workflow state and belongs in the permissions status RPC and stream event.
- Reading raw metadata-dict keys (`liveState.metadata?.member_count`) from a render component. Translators exist for a reason.
- A re-index call without a matching `publish_mention_state` (or vice versa). The two together are the contract.
- A new chip variant with bespoke layout instead of using `<ParentBadge>` / `<MetaSeparator>`.
- Skipping the `if channel.channel_type != ChannelType.PUBLIC` style guard "for performance" - PUBLIC channels live in the index and need re-indexing on every mutation.
- Dispatching `setMentionState` without `publishMentionState`. Outside-context chips never wake up; the bug stays invisible until someone opens the editor.
- A diff-based publish payload. The full denormalized state is the contract.

---

## Key files

| File | Purpose |
|------|---------|
| `src/proto/search/v1/search.proto` | `UrnMetadata` shape. Add new typed fields here when the metadata-dict-only path is too loose. |
| `src/uniffy/core/content/base_operations.py` | `_get_search_metadata_async` hook + canonical `_index_for_search`. |
| `src/uniffy/core/search/indexer.py` | `SearchIndexer.index` / `remove`. |
| `src/uniffy/core/valkey/mentions.py` | `publish_mention_state`. |
| `src/uniffy/core/content/reference_state.py` | Registered authoritative state loaders for successful raw-index misses. |
| `src/uniffy/domains/search/operations.py` | Two-pass typed availability classification and metadata scrubbing. |
| `src/uniffy/domains/search/converters.py` | `SearchResult` -> `UrnMetadata` proto, including `urn_status` passthrough. |
| `src/uniffy/domains/search/queries.py` | `SearchResult` dataclass. |
| `src/ui/src/components/mention/types.ts` | `MentionLiveState`. |
| `src/ui/src/components/mention/MentionStateProvider.tsx` | React provider, `metadataToLiveState`, `streamChangesToLiveState`. |
| `src/ui/src/components/mention/useBatchedSubjectResolver.ts` | Module-level batch resolver, `previewDataToLiveState`, broadcast. |
| `src/ui/src/components/mention/useMentionState.ts` | The hook every chip uses to subscribe. |
| `src/ui/src/components/mention/mentionStateEmitter.ts` | Module-level emitter (`publishMentionState` etc.). |
| `src/ui/src/components/mention/MentionChip.tsx` | Full/compact available, restricted, deleted, unavailable, and skeleton states. |
| `src/ui/src/components/mention/MentionExpandedCard.tsx` | Block-level wrapper that routes to per-type preview. |
| `src/ui/src/components/mention/previews/ParentBadge.tsx` | Shared `<ParentBadge>` + `<MetaSeparator>`. |
| `src/ui/src/components/mention/previews/*MentionPreview.tsx` | Per-type expanded card body. |
| `src/ui/src/components/mention/mentionConstants.ts` | `EXPANDABLE_URN_TYPES`. |
| `src/ui/src/features/notifications/hooks/useNotificationStream.ts` | Streams mention patches and access-request state into the shared cache. |
