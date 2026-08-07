import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { MagnifyingGlass, PushPin, PushPinSlash, Plus, Trash, X } from "phosphor-react-native";
import { MemoryCategory, MemoryScope } from "@uniffy/proto/agents/v1/memories_pb";
import { useAuth } from "@core/providers/AuthContext";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useMemories, useMemoryMutations } from "@features/agents/useMemories";
import {
  CATEGORY_LABELS,
  EDITABLE_CATEGORIES,
  type MemorySubject,
  type SerializedMemory,
} from "@features/agents/memorySerializer";

interface DraftState {
  memory: SerializedMemory | null;
  key: string;
  description: string;
  content: string;
  category: MemoryCategory;
}

const BLANK_DRAFT: DraftState = {
  memory: null,
  key: "",
  description: "",
  content: "",
  category: MemoryCategory.FACTS,
};

/**
 * What an agent remembers in this conversation. A 1:1 agent DM shows the
 * caller's own store, shared by every agent they talk to; a channel shows the
 * shared channel bucket.
 *
 * Renders flat, with no scroll container of its own - it expands inside the
 * host sheet's scroll rather than opening a second one.
 */
export function AgentMemoryPanel({
  T,
  subject,
  isModerator,
  enabled,
}: {
  T: ThemeColors;
  subject: MemorySubject;
  /** Channel buckets are moderated; a personal bucket is always the owner's. */
  isModerator: boolean;
  /** Fetching is deferred until the section is actually open. */
  enabled: boolean;
}) {
  const { user } = useAuth();
  const memoriesQuery = useMemories(subject, enabled);
  const { create, update, remove, setPinned } = useMemoryMutations(subject);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<DraftState | null>(null);

  const isPersonal = subject.scope === MemoryScope.USER;
  const canPin = isPersonal || isModerator;
  const canMutate = (memory: SerializedMemory) =>
    isPersonal || isModerator || memory.createdByUserId === user?.id;

  const memories = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = memoriesQuery.data ?? [];
    if (!q) return all;
    return all.filter(
      (m) =>
        m.key.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q),
    );
  }, [memoriesQuery.data, search]);

  const confirmDelete = (memory: SerializedMemory) => {
    Alert.alert("Forget this?", memory.description || memory.key, [
      { text: "Cancel", style: "cancel" },
      { text: "Forget", style: "destructive", onPress: () => remove.mutate(memory.id) },
    ]);
  };

  const saveDraft = () => {
    if (!draft) return;
    const description = draft.description.trim();
    const content = draft.content.trim();
    if (!content || !description) return;
    if (draft.memory) {
      update.mutate(
        { memoryId: draft.memory.id, content, description, category: draft.category },
        { onSuccess: () => setDraft(null) },
      );
      return;
    }
    const key = draft.key.trim();
    if (!key) return;
    create.mutate(
      { key, content, description, category: draft.category },
      { onSuccess: () => setDraft(null) },
    );
  };

  if (draft) {
    return (
      <View>
        <View style={styles.draftHead}>
          <Text style={[styles.draftTitle, { color: T.textBright }]}>
            {draft.memory ? "Edit memory" : "New memory"}
          </Text>
          <TouchableOpacity
            onPress={() => setDraft(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={16} color={T.textDim} weight="bold" />
          </TouchableOpacity>
        </View>
        {draft.memory ? null : (
          <>
            <Text style={[styles.fieldLabel, { color: T.textDim }]}>KEY</Text>
            <TextInput
              value={draft.key}
              onChangeText={(key) => setDraft({ ...draft, key })}
              placeholder="short-identifier"
              placeholderTextColor={T.textDim}
              autoCapitalize="none"
              style={[
                styles.input,
                { color: T.textBright, backgroundColor: T.bg, borderColor: T.border },
              ]}
            />
          </>
        )}
        <Text style={[styles.fieldLabel, { color: T.textDim }]}>DESCRIPTION</Text>
        <TextInput
          value={draft.description}
          onChangeText={(description) => setDraft({ ...draft, description })}
          placeholder="One line the agent uses to decide when this matters"
          placeholderTextColor={T.textDim}
          style={[
            styles.input,
            { color: T.textBright, backgroundColor: T.bg, borderColor: T.border },
          ]}
        />
        <Text style={[styles.fieldLabel, { color: T.textDim }]}>CONTENT</Text>
        <TextInput
          value={draft.content}
          onChangeText={(content) => setDraft({ ...draft, content })}
          placeholder="What to remember"
          placeholderTextColor={T.textDim}
          multiline
          style={[
            styles.input,
            styles.inputMultiline,
            { color: T.textBright, backgroundColor: T.bg, borderColor: T.border },
          ]}
        />
        <Text style={[styles.fieldLabel, { color: T.textDim }]}>CATEGORY</Text>
        <View style={styles.chipRow}>
          {EDITABLE_CATEGORIES.map((category) => {
            const active = draft.category === category;
            return (
              <TouchableOpacity
                key={category}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? T.accentSoft : T.bg,
                    borderColor: active ? T.accent : T.border,
                  },
                ]}
                onPress={() => setDraft({ ...draft, category })}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, { color: active ? T.accent : T.text }]}>
                  {CATEGORY_LABELS[category]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: T.accent }]}
          onPress={saveDraft}
          disabled={create.isPending || update.isPending}
          activeOpacity={0.8}
        >
          <Text style={styles.ctaText}>
            {create.isPending || update.isPending ? "Saving..." : "Save"}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.toolbar}>
        <View style={[styles.searchBox, { backgroundColor: T.bg, borderColor: T.border }]}>
          <MagnifyingGlass size={15} color={T.textDim} weight="bold" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search memories"
            placeholderTextColor={T.textDim}
            style={[styles.searchInput, { color: T.textBright }]}
          />
        </View>
        {isPersonal ? (
          <TouchableOpacity
            style={[styles.addButton, { borderColor: T.border }]}
            onPress={() => setDraft(BLANK_DRAFT)}
            activeOpacity={0.7}
            accessibilityLabel="New memory"
          >
            <Plus size={16} color={T.accent} weight="bold" />
          </TouchableOpacity>
        ) : null}
      </View>

      {memoriesQuery.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={T.accent} />
        </View>
      ) : memories.length === 0 ? (
        <Text style={[styles.empty, { color: T.textDim }]}>
          {search
            ? "No memories match your search."
            : isPersonal
              ? "Nothing remembered about you yet. Entries are created during conversations with any of your agents."
              : "Nothing remembered in this channel yet."}
        </Text>
      ) : (
        memories.map((memory) => (
          <MemoryRow
            key={memory.id}
            T={T}
            memory={memory}
            canPin={canPin}
            canMutate={canMutate(memory)}
            onEdit={() =>
              setDraft({
                memory,
                key: memory.key,
                description: memory.description,
                content: memory.content,
                category: memory.category,
              })
            }
            onTogglePin={() => setPinned.mutate({ memoryId: memory.id, pinned: !memory.pinned })}
            onDelete={() => confirmDelete(memory)}
          />
        ))
      )}
    </View>
  );
}

function MemoryRow({
  T,
  memory,
  canPin,
  canMutate,
  onEdit,
  onTogglePin,
  onDelete,
}: {
  T: ThemeColors;
  memory: SerializedMemory;
  canPin: boolean;
  canMutate: boolean;
  onEdit: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const author = memory.createdByAgentName || memory.createdByName;

  return (
    <View style={[styles.memoryRow, { borderTopColor: T.border }]}>
      <TouchableOpacity
        style={styles.memoryBody}
        onPress={() => setExpanded((open) => !open)}
        onLongPress={canMutate ? onEdit : undefined}
        delayLongPress={300}
        activeOpacity={0.7}
      >
        <View style={styles.memoryHead}>
          {memory.pinned ? <PushPin size={12} color={T.accent} weight="fill" /> : null}
          <Text
            style={[styles.memoryTitle, { color: T.textBright }]}
            numberOfLines={expanded ? 0 : 2}
          >
            {memory.description || memory.key}
          </Text>
        </View>
        <Text style={[styles.memoryContent, { color: T.textDim }]} numberOfLines={expanded ? 0 : 2}>
          {memory.content}
        </Text>
        <Text style={[styles.memoryMeta, { color: T.textDim }]} numberOfLines={1}>
          {CATEGORY_LABELS[memory.category] ?? "Unspecified"}
          {author ? ` · ${author}` : ""}
        </Text>
      </TouchableOpacity>
      <View style={styles.memoryActions}>
        {canPin ? (
          <TouchableOpacity
            onPress={onTogglePin}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {memory.pinned ? (
              <PushPinSlash size={16} color={T.textDim} weight="duotone" />
            ) : (
              <PushPin size={16} color={T.textDim} weight="duotone" />
            )}
          </TouchableOpacity>
        ) : null}
        {canMutate ? (
          <TouchableOpacity onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Trash size={16} color={T.red} weight="duotone" />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 4 },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: FONT.regular, padding: 0 },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  loading: { paddingVertical: 20, alignItems: "center" },
  empty: { fontSize: 12, fontFamily: FONT.regular, paddingVertical: 14, lineHeight: 18 },
  memoryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  memoryBody: { flex: 1, gap: 3 },
  memoryHead: { flexDirection: "row", alignItems: "center", gap: 5 },
  memoryTitle: { fontSize: 13, fontFamily: FONT.medium, flexShrink: 1 },
  memoryContent: { fontSize: 12, fontFamily: FONT.regular, lineHeight: 17 },
  memoryMeta: { fontSize: 11, fontFamily: FONT.regular },
  memoryActions: { flexDirection: "row", alignItems: "center", gap: 14, paddingTop: 2 },
  draftHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 2,
  },
  draftTitle: { fontSize: 14, fontFamily: FONT.semibold },
  fieldLabel: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    letterSpacing: 0.8,
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: FONT.regular,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 12, fontFamily: FONT.medium },
  cta: { marginTop: 16, paddingVertical: 12, borderRadius: 11, alignItems: "center" },
  ctaText: { fontSize: 14, fontFamily: FONT.semibold, color: "#fff" },
});
