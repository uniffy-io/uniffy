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
2. **Snapshot-safe**: when the reference target is deleted or no longer accessible, the chip renders a tombstone - a half-broken card or a generic "Note content" placeholder reads as a bug.
3. **Pure-Meili reads**: the resolve path runs zero database queries. Everything a chip displays is denormalized into the Meilisearch document at index time. If a chip needs a new field, add it to the index rather than to a resolve-time enrichment hook.
4. **Same look everywhere**: chips render identically in chat messages, search results, comments, and the note editor. There is one chip component, not three.
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

### Live updates: `publish_mention_state`

Re-indexing alone is not enough - already-rendered chips do not poll. After every re-index call `publish_mention_state(organization_id, urn, changes)` to push the patch to subscribers.

Conventions:

- The `changes` payload is a `dict[str, str]` with snake_case keys - same shape as the index metadata, plus virtual keys `title`, `description`, `urn_status`.
- Send the **full** denormalized payload rather than a diff. Diffing across callers tends to be fragile; the payload is small.
- The publish call is idempotent - safe to retry, safe to no-op when there are no listeners (Valkey-down case).

### Resolve path (read-only, no DB!)

`SearchOperations.resolve_urns` is the public read path. It:

1. Fetches `UrnMetadata` documents from Meilisearch (permission-filtered there).
2. **Synthesizes tombstone results** for every input URN missing from the index. Tombstones carry `urn_status="DELETED"` so the chip renders a deleted-state rather than a generic fallback. We do not distinguish `DELETED` / `NOT_FOUND` / `FORBIDDEN` - "missing from index" is treated uniformly.
3. Returns one `SearchResult` per input URN (silent drops are a bug).

**Adding new database queries to `resolve_urns` or to `_enrich_*` helpers tends to regress the design.** If a chip needs a new field, push it into the index from the writing domain. The single `_enrich_channels` helper that survives is intentionally a no-op left in place to document that decision.

### Cascade-removal on parent delete

Deleting a parent must cascade through every child that lives in the search index. Otherwise global search keeps surfacing orphans that point to a target the user can no longer open, and mention chips render valid-looking previews for content that is gone.

Two patterns:

| Shape | Where to wire | How |
|-------|---------------|-----|
| Per-row remove during bulk traversal | The recursive helper that mutates children (e.g. `FolderOperations._delete_contents`, `NoteOperations._collect_descendant_ids`) | Loop and call `SearchIndexer.remove(build_content_urn(type, id))` per child. |
| Filter-based bulk drop | Single-shot helper at the top-level delete (e.g. `ChatChannelOperations.delete_channel`, `ProjectOperations.delete`) | `SearchIndexer.remove_by_filter(filter_expr)` against a filterable metadata field. |

The filter approach requires the child to carry a parent id in its search metadata **and** that field be declared in `filterable_attributes` (`core/search/meilisearch.py`). Today: `metadata.channel_id` (chat messages), `metadata.project_id` (tasks), `metadata.folder_id` (files).

When you add a new parent/child relationship that reaches search, add the parent id to the child's `_get_search_metadata` and to the filterable list, then wire the cascade. Skipping the cascade is the default failure mode - the index keeps growing and "deleted" content stays searchable.

### Tombstones

A URN is missing from Meilisearch if any of:
- the content was deleted (`SearchIndexer.remove(urn)` was called)
- the document was never indexed (data corruption / new content type rollout)
- the requesting user lacks permission

All three look identical to the resolver. The frontend renders them as a dashed, strikethrough "Deleted X" chip. There is no recovery flow - the chip is dead, the reader knows it is dead, that is the whole behaviour.

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
│  ├─ ChatMentionPreview
│  ├─ CalendarMentionPreview
│  ├─ ProjectMentionPreview
│  ├─ UserMentionPreview
│  └─ AgentMentionPreview
├─ MentionExpandedCardSkeleton  (loading footprint, prevents size jump)
├─ MentionTombstoneChip / MentionTombstoneCard  (deleted state)
└─ MentionPreview (popover; non-expandable types only)

MentionChipCompact   (dense inline pill; same data, smaller)
MentionChipBasic     (no Redux, no live state; ProseMirror render fallback)
```

**Expandable types** (rendered as block card by default): `TASK`, `CALENDAR_EVENT`, `PROJECT`, `FILE`, `NOTE`, `CHAT`. See `mentionConstants.ts`. Other types render as inline pills with a hover popover.

The user's `mentionDisplay` setting (`expanded` / `compact`) controls the default. Per-chip toggles persist in `localStorage` under `mention-toggle:{urn}`.

### Consistent placement

The expanded card header has a fixed slot order in its meta row:

```
[icon-badge]  TITLE
              📁 ParentLabel  ·  TypeLabel  ·  TypeMeta1  ·  TypeMeta2 …
```

`ParentLabel` (folder / category / parent note) is always **first** in the meta row, rendered via the shared `<ParentBadge>` component (`previews/ParentBadge.tsx`). `<MetaSeparator>` is the canonical middle-dot. Rolling your own breadcrumb here tends to fragment the visual language - it is the bug we keep cleaning up.

When you add a new mention type or extend an existing preview, place new metadata to the **right** of the existing row rather than inside it.

### Tombstone rendering

`MentionLiveState.status === 'deleted'` short-circuits the render before any other branch. The chip renders `MentionTombstoneChip` (compact) or `MentionTombstoneCard` (expanded). Hover, click, expand, and live indicators are all suppressed - there is nothing to navigate to.

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

- DB queries inside `resolve_urns` or any `_enrich_*` helper. The pattern is retired; every new addition is a regression.
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
| `src/uniffy/domains/search/operations.py` | `resolve_urns` + tombstone synthesis (`_build_tombstone`). |
| `src/uniffy/domains/search/converters.py` | `SearchResult` -> `UrnMetadata` proto, including `urn_status` passthrough. |
| `src/uniffy/domains/search/queries.py` | `SearchResult` dataclass. |
| `src/ui/src/components/mention/types.ts` | `MentionLiveState`. |
| `src/ui/src/components/mention/MentionStateProvider.tsx` | React provider, `metadataToLiveState`, `streamChangesToLiveState`. |
| `src/ui/src/components/mention/useBatchedSubjectResolver.ts` | Module-level batch resolver, `previewDataToLiveState`, broadcast. |
| `src/ui/src/components/mention/useMentionState.ts` | The hook every chip uses to subscribe. |
| `src/ui/src/components/mention/mentionStateEmitter.ts` | Module-level emitter (`publishMentionState` etc.). |
| `src/ui/src/components/mention/MentionChip.tsx` | Full chip + compact + basic + tombstone + skeleton. |
| `src/ui/src/components/mention/MentionExpandedCard.tsx` | Block-level wrapper that routes to per-type preview. |
| `src/ui/src/components/mention/previews/ParentBadge.tsx` | Shared `<ParentBadge>` + `<MetaSeparator>`. |
| `src/ui/src/components/mention/previews/*MentionPreview.tsx` | Per-type expanded card body. |
| `src/ui/src/components/mention/mentionConstants.ts` | `EXPANDABLE_URN_TYPES`. |
| `src/ui/src/features/notifications/hooks/useNotificationStream.ts` | Streams `MENTION_STATE_CHANGED` into `emitMentionStateChange`. |
