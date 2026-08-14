import { useCallback, useEffect, useMemo, useState } from "react";
import { Brain, CircleNotch, MagnifyingGlass, Plus, PushPin } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { MemoryScope } from "@uniffy/proto/agents/v1/memories_pb";
import { selectMemoryScope } from "@/features/agents/store/agentMemoriesSlice";
import {
  fetchMemories,
  createMemory,
  updateMemory,
  deleteMemory,
  setMemoryPinned,
  memoryScopeKey,
} from "@/features/agents/store/agentMemoriesThunks";
import type { SerializedMemory } from "@/features/agents/store/agentMemoriesThunks";
import { CATEGORY_FILTER_OPTIONS } from "@/features/agents/components/memory/memoryCategories";
import { MemoryAudienceBanner } from "@/features/agents/components/memory/MemoryAudienceBanner";
import { MemoryRow } from "@/features/agents/components/memory/MemoryRow";
import {
  MemoryCreateForm,
  type MemoryFormValues,
} from "@/features/agents/components/memory/MemoryEditForm";

export interface MemoryScopeDescriptor {
  scope: MemoryScope;
  subjectId?: string;
  /** Organization memory only: narrows the list to one agent's entries. */
  agentId?: string;
  canCreate: boolean;
  canPin: boolean;
  canEdit: (memory: SerializedMemory) => boolean;
  canDelete: (memory: SerializedMemory) => boolean;
}

const PINNED_MAX_ENTRIES = 5;
const PINNED_MAX_CHARS = 2000;

function emptyStateCopy(descriptor: MemoryScopeDescriptor): string {
  switch (descriptor.scope) {
    case MemoryScope.ORG:
      return descriptor.agentId
        ? "Nothing kept for this agent alone yet. Entries here reach only its conversations."
        : "No organization-wide memories yet. Agent managers can add entries every agent should know.";
    case MemoryScope.CHANNEL:
      return "No channel memories yet. Agents save shared facts here during conversations in this channel.";
    case MemoryScope.SESSION:
      return "No session memories yet. Agents save shared facts here during this session.";
    default:
      return "Nothing remembered about you yet. Entries are created during conversations with any of your agents.";
  }
}

function byImportanceThenRecency(a: SerializedMemory, b: SerializedMemory): number {
  if (b.importance !== a.importance) return b.importance - a.importance;
  return (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0);
}

export function MemoryList({
  agentName,
  descriptor,
  subjectLabel,
}: {
  agentName?: string;
  descriptor: MemoryScopeDescriptor;
  subjectLabel?: string;
}) {
  const dispatch = useAppDispatch();
  const { scope, subjectId, agentId, canCreate, canPin, canEdit, canDelete } = descriptor;
  const scopeKey = memoryScopeKey(descriptor);
  const scopeState = useAppSelector(selectMemoryScope(scopeKey));

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    dispatch(
      fetchMemories({
        scope,
        subjectId,
        agentId,
        category: categoryFilter !== "all" ? Number(categoryFilter) : undefined,
        search: search.trim() || undefined,
      }),
    );
  }, [dispatch, scope, subjectId, agentId, categoryFilter, search]);

  const memories = useMemo(() => Object.values(scopeState.memories), [scopeState.memories]);

  const filteredMemories = useMemo(() => {
    let result = memories;
    if (search.trim()) {
      const query = search.toLowerCase();
      result = result.filter(
        (m) =>
          m.key.toLowerCase().includes(query) ||
          m.description.toLowerCase().includes(query) ||
          m.content.toLowerCase().includes(query),
      );
    }
    return [...result].sort(byImportanceThenRecency);
  }, [memories, search]);

  const pinnedMemories = useMemo(
    () => filteredMemories.filter((m) => m.pinned),
    [filteredMemories],
  );
  const indexMemories = useMemo(
    () => filteredMemories.filter((m) => !m.pinned),
    [filteredMemories],
  );
  const pinnedBudget = useMemo(() => {
    const allPinned = memories.filter((m) => m.pinned);
    return {
      count: allPinned.length,
      chars: allPinned.reduce((sum, m) => sum + m.content.length, 0),
    };
  }, [memories]);

  const handleCreate = useCallback(
    (values: MemoryFormValues & { key: string }) => {
      dispatch(
        createMemory({
          scope,
          subjectId,
          agentId,
          key: values.key,
          description: values.description,
          content: values.content,
          category: values.category,
          importance: values.importance,
        }),
      );
      setShowCreateForm(false);
    },
    [dispatch, scope, subjectId, agentId],
  );

  const handleSave = useCallback(
    (memoryId: string, values: MemoryFormValues) => {
      dispatch(
        updateMemory({
          scopeKey,
          memoryId,
          description: values.description,
          content: values.content,
          category: values.category,
          importance: values.importance,
        }),
      );
      setEditingId(null);
    },
    [dispatch, scopeKey],
  );

  const handleDelete = useCallback(
    (memoryId: string) => {
      dispatch(deleteMemory({ scopeKey, memoryId }));
    },
    [dispatch, scopeKey],
  );

  const handleTogglePin = useCallback(
    (memory: SerializedMemory) => {
      dispatch(setMemoryPinned({ scopeKey, memoryId: memory.id, pinned: !memory.pinned }));
    },
    [dispatch, scopeKey],
  );

  const renderRow = (memory: SerializedMemory) => (
    <MemoryRow
      key={memory.id}
      memory={memory}
      canPin={canPin}
      canEdit={canEdit(memory)}
      canDelete={canDelete(memory)}
      isEditing={editingId === memory.id}
      onEdit={() => setEditingId(memory.id)}
      onCancelEdit={() => setEditingId(null)}
      onSave={(values) => handleSave(memory.id, values)}
      onDelete={() => handleDelete(memory.id)}
      onTogglePin={() => handleTogglePin(memory)}
    />
  );

  if (scopeState.loading && memories.length === 0) {
    return (
      <div className="space-y-4">
        <MemoryAudienceBanner
          descriptor={descriptor}
          agentName={agentName}
          subjectLabel={subjectLabel}
        />
        <div className="flex items-center justify-center py-12">
          <CircleNotch size={24} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <MemoryAudienceBanner
        descriptor={descriptor}
        agentName={agentName}
        subjectLabel={subjectLabel}
      />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 max-w-sm relative">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search memories..."
            className="pl-9"
          />
        </div>
        <Select
          value={categoryFilter}
          onChange={(val) => setCategoryFilter(val)}
          options={CATEGORY_FILTER_OPTIONS}
        />
        <span className="text-sm text-muted-foreground">
          {filteredMemories.length} {filteredMemories.length === 1 ? "memory" : "memories"}
        </span>
        {canCreate && (
          <button
            type="button"
            onClick={() => setShowCreateForm(!showCreateForm)}
            className={cn(
              "p-1.5 rounded-md transition-colors cursor-pointer",
              showCreateForm
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
            title="Add memory"
          >
            <Plus size={18} />
          </button>
        )}
      </div>

      {showCreateForm && canCreate && (
        <MemoryCreateForm onSubmit={handleCreate} onCancel={() => setShowCreateForm(false)} />
      )}

      {pinnedMemories.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <PushPin size={12} weight="fill" />
              Always in context
            </h4>
            <span className="text-xs text-muted-foreground tabular-nums">
              {pinnedBudget.count}/{PINNED_MAX_ENTRIES} pinned -{" "}
              {pinnedBudget.chars.toLocaleString()}/{PINNED_MAX_CHARS.toLocaleString()} chars
            </span>
          </div>
          <div className="space-y-3">{pinnedMemories.map(renderRow)}</div>
        </div>
      )}

      <div className="space-y-3">{indexMemories.map(renderRow)}</div>

      {filteredMemories.length === 0 && !scopeState.loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Brain size={48} weight="duotone" className="text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground font-medium">No memories found</p>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
            {emptyStateCopy(descriptor)}
          </p>
        </div>
      )}
    </div>
  );
}
