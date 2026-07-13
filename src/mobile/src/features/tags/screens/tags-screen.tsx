import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
} from "react-native";
import {
  MagnifyingGlass,
  X,
  Plus,
  Tag as TagIcon,
  PencilSimple,
  Trash,
} from "phosphor-react-native";
import { router } from "expo-router";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useTags, useTagMutations } from "@features/tags/useTags";
import { TAG_COLORS, type SerializedTag } from "@features/tags/tagSerializer";

export default function TagsScreen() {
  const T = useTheme();
  const [query, setQuery] = useState("");
  const tags = useTags(query);
  const { remove } = useTagMutations();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SerializedTag | null>(null);

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const openEdit = useCallback((tag: SerializedTag) => {
    setEditing(tag);
    setEditorOpen(true);
  }, []);

  const confirmDelete = useCallback(
    (tag: SerializedTag) => {
      Alert.alert("Delete tag", `Remove "${tag.name}"? It will be unassigned from all content.`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => remove.mutate(tag.id) },
      ]);
    },
    [remove],
  );

  const renderItem = useCallback(
    ({ item }: { item: SerializedTag }) => (
      <TagRow
        tag={item}
        T={T}
        onPress={() =>
          router.push({ pathname: "/tags/[id]", params: { id: item.id, name: item.name } } as any)
        }
        onEdit={() => openEdit(item)}
        onDelete={() => confirmDelete(item)}
      />
    ),
    [T, openEdit, confirmDelete],
  );

  const data = tags.data ?? [];

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Tags"
        color={T.accent}
        icon="tag"
        rightActions={
          <TouchableOpacity onPress={openCreate} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Plus size={21} color={T.accent} weight="bold" />
          </TouchableOpacity>
        }
      />

      <View style={[styles.searchWrap, { borderBottomColor: T.border }]}>
        <View style={[styles.searchRow, { backgroundColor: T.surface, borderColor: T.border }]}>
          <MagnifyingGlass size={16} color={T.textDim} weight="bold" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search tags..."
            placeholderTextColor={T.textDim}
            style={[styles.searchInput, { color: T.textBright }]}
            autoCapitalize="none"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <X size={14} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {tags.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <FlatList
          data={data}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={data.length === 0 ? styles.emptyContent : styles.listContent}
          ListEmptyComponent={<EmptyTags T={T} query={query} />}
          refreshControl={
            <RefreshControl
              refreshing={tags.isFetching && !tags.isLoading}
              onRefresh={() => tags.refetch()}
              tintColor={T.accent}
              colors={[T.accent]}
            />
          }
        />
      )}

      <TagEditorModal
        visible={editorOpen}
        T={T}
        tag={editing}
        onClose={() => setEditorOpen(false)}
      />
    </View>
  );
}

function TagRow({
  tag,
  T,
  onPress,
  onEdit,
  onDelete,
}: {
  tag: SerializedTag;
  T: ThemeColors;
  onPress: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: T.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.colorDot, { backgroundColor: tag.color }]} />
      <View style={styles.body}>
        <Text style={[styles.name, { color: T.textBright }]} numberOfLines={1}>
          {tag.name}
        </Text>
        {tag.description ? (
          <Text style={[styles.desc, { color: T.textDim }]} numberOfLines={1}>
            {tag.description}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.count, { color: T.textDim }]}>{tag.usageCount}</Text>
      <TouchableOpacity
        onPress={onEdit}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 4 }}
        style={styles.iconBtn}
      >
        <PencilSimple size={16} color={T.textDim} weight="duotone" />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onDelete}
        hitSlop={{ top: 10, bottom: 10, left: 4, right: 8 }}
        style={styles.iconBtn}
      >
        <Trash size={16} color="#FA5252" weight="duotone" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function TagEditorModal({
  visible,
  T,
  tag,
  onClose,
}: {
  visible: boolean;
  T: ThemeColors;
  tag: SerializedTag | null;
  onClose: () => void;
}) {
  const { create, update } = useTagMutations();
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  // Sync form when the target tag changes (open for edit vs create).
  React.useEffect(() => {
    if (visible) {
      setName(tag?.name ?? "");
      setColor(tag?.color ?? TAG_COLORS[0]);
      setDescription(tag?.description ?? "");
    }
  }, [visible, tag]);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (tag) {
        await update.mutateAsync({ tagId: tag.id, name: name.trim(), color, description });
      } else {
        await create.mutateAsync({ name: name.trim(), color, description });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.editorCard, { backgroundColor: T.surface }]}>
          <View style={styles.editorHeader}>
            <Text style={[styles.editorTitle, { color: T.textBright }]}>
              {tag ? "Edit tag" : "New tag"}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={18} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          </View>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Tag name"
            placeholderTextColor={T.textDim}
            style={[
              styles.editorInput,
              { color: T.textBright, backgroundColor: T.bg, borderColor: T.border },
            ]}
            autoFocus
          />
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Description (optional)"
            placeholderTextColor={T.textDim}
            style={[
              styles.editorInput,
              { color: T.textBright, backgroundColor: T.bg, borderColor: T.border },
            ]}
          />

          <Text style={[styles.editorLabel, { color: T.textDim }]}>COLOR</Text>
          <View style={styles.colorGrid}>
            {TAG_COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[
                  styles.colorOption,
                  { backgroundColor: c, borderColor: color === c ? T.textBright : "transparent" },
                ]}
                onPress={() => setColor(c)}
                activeOpacity={0.7}
              />
            ))}
          </View>

          <TouchableOpacity
            style={[styles.editorBtn, { backgroundColor: name.trim() ? T.accent : T.surfaceHover }]}
            onPress={submit}
            disabled={!name.trim() || busy}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={[styles.editorBtnText, { color: name.trim() ? "#fff" : T.textDim }]}>
                {tag ? "Save" : "Create tag"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function EmptyTags({ T, query }: { T: ThemeColors; query: string }) {
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIconWrap, { backgroundColor: T.accentSoft }]}>
        <TagIcon size={36} color={T.accent} weight="duotone" />
      </View>
      <Text style={[styles.emptyTitle, { color: T.textBright }]}>
        {query.trim() ? "No matching tags" : "No tags yet"}
      </Text>
      <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
        {query.trim()
          ? "Try a different search"
          : "Create a tag to organize content across the workspace"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchWrap: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: FONT.regular },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: 24 },
  emptyContent: { flexGrow: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  body: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontFamily: FONT.semibold },
  desc: { fontSize: 12, fontFamily: FONT.regular },
  count: { fontSize: 13, fontFamily: FONT.semibold, minWidth: 20, textAlign: "right" },
  iconBtn: { padding: 4 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  editorCard: { width: "100%", borderRadius: 16, padding: 20, gap: 12 },
  editorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  editorTitle: { fontSize: 16, fontFamily: FONT.bold },
  editorInput: {
    height: 46,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: FONT.regular,
  },
  editorLabel: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.8, marginTop: 4 },
  colorGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  colorOption: { width: 30, height: 30, borderRadius: 15, borderWidth: 2 },
  editorBtn: {
    height: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  editorBtnText: { fontSize: 15, fontFamily: FONT.semibold },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 17, fontFamily: FONT.semibold },
  emptySubtitle: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", lineHeight: 20 },
});
