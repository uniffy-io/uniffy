import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Star, DotsThree, PencilSimple, ShareNetwork, CaretRight } from "phosphor-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@/components/DomainHeader";
import { ActionSheet } from "@/components/ActionSheet";
import { getDomainColor, getDomainSoftColor, DOMAIN_ICON } from "@/components/ReferenceChip";
import { Avatar } from "@/components/Avatar";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { useTheme } from "@/hooks/useTheme";
import { DOMAIN_COLORS } from "@/constants/theme";
import { useNote, useNoteBacklinks } from "@/hooks/useNotes";
import { useDeleteNote } from "@/hooks/useNoteMutations";
import { useAuth } from "@/context/auth-context";
import { useIsBookmarked, useToggleBookmark } from "@/hooks/useBookmarks";
import { formatRelativeTime } from "@/lib/noteSerializer";

export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const T = useTheme();
  const [sheetOpen, setSheetOpen] = useState(false);
  const auth = useAuth();
  const noteQuery = useNote(id);
  const backlinksQuery = useNoteBacklinks(id);
  const deleteNote = useDeleteNote();
  const noteUrn = id ? `urn:uniffy:content:NOTE:${id}` : "";
  const bookmarkQuery = useIsBookmarked(noteUrn);
  const toggleBookmark = useToggleBookmark();
  const isBookmarked = bookmarkQuery.data ?? false;

  if (noteQuery.isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: T.pageBg }]}>
        <DomainHeader title="Notes" color={DOMAIN_COLORS.notes} icon="notes" />
        <View style={styles.notFound}>
          <ActivityIndicator size="large" color={DOMAIN_COLORS.notes} />
        </View>
      </View>
    );
  }

  const note = noteQuery.data;

  if (!note) {
    return (
      <View style={[styles.container, { backgroundColor: T.pageBg }]}>
        <DomainHeader title="Notes" color={DOMAIN_COLORS.notes} icon="notes" />
        <View style={styles.notFound}>
          <Text style={{ color: T.textDim }}>Note not found</Text>
        </View>
      </View>
    );
  }

  const authorName = note.ownerInfo?.name || auth.user?.fullName || "Unknown";
  const editedAt = note.updatedAt ? formatRelativeTime(note.updatedAt.seconds) : "just now";
  const backlinks = backlinksQuery.data ?? [];

  const actionBar = [
    {
      IconComponent: PencilSimple,
      label: "Edit",
      onPress: () => router.push(`/notes/edit?noteId=${note.id}` as any),
    },
    { IconComponent: ShareNetwork, label: "Share", onPress: () => {} },
    { IconComponent: DotsThree, label: "More", onPress: () => setSheetOpen(true) },
  ];

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Notes"
        color={DOMAIN_COLORS.notes}
        icon="notes"
        rightActions={
          <>
            <TouchableOpacity
              onPress={() => toggleBookmark.mutate(noteUrn)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Star
                size={19}
                color={isBookmarked ? DOMAIN_COLORS.notes : T.textDim}
                weight={isBookmarked ? "fill" : "duotone"}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setSheetOpen(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <DotsThree size={22} color={T.text} weight="bold" />
            </TouchableOpacity>
          </>
        }
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: 60, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: T.textBright }]}>{note.title}</Text>

        <View style={styles.authorRow}>
          <Avatar name={authorName} size={24} />
          <Text style={[styles.authorName, { color: T.text }]}>{authorName}</Text>
          <Text style={[styles.editTime, { color: T.textDim }]}>· edited {editedAt}</Text>
        </View>

        <View style={styles.tagsRow}>
          {(note.tags ?? []).map((tag) => (
            <View key={tag} style={[styles.tag, { backgroundColor: T.accentSoft }]}>
              <Text style={[styles.tagText, { color: T.accent }]}>{tag}</Text>
            </View>
          ))}
        </View>

        <View style={styles.body}>
          <MarkdownRenderer content={note.content || ""} />
        </View>

        {backlinks.length > 0 && (
          <View style={[styles.refsSection, { borderTopColor: T.border }]}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>
              REFERENCED BY {backlinks.length} ITEMS
            </Text>
            {backlinks.map((ref, i) => {
              const color = getDomainColor("notes");
              const softColor = getDomainSoftColor("notes");
              const RefIcon = DOMAIN_ICON["notes"];
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.refRow, { backgroundColor: T.surface, borderColor: T.border }]}
                  onPress={() => router.push(`/notes/${ref.id}` as any)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.refIcon, { backgroundColor: softColor }]}>
                    <RefIcon size={14} color={color} weight="bold" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.refTitle, { color: T.textBright }]}>{ref.title}</Text>
                  </View>
                  <CaretRight size={14} color={T.textDim} weight="bold" />
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={[styles.actionBar, { backgroundColor: T.surface, borderTopColor: T.border }]}>
        {actionBar.map((action) => (
          <TouchableOpacity
            key={action.label}
            style={styles.actionBtn}
            onPress={action.onPress}
            activeOpacity={0.7}
          >
            <action.IconComponent size={18} color={T.text} weight="duotone" />
            <Text style={[styles.actionLabel, { color: T.textDim }]}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={note.title}
        subtitle={`${note.outgoingReferences.length} references · ${editedAt}`}
        icon="notes"
        iconColor={DOMAIN_COLORS.notes}
        actions={[
          {
            icon: "edit-2",
            label: "Edit note",
            onPress: () => {
              setSheetOpen(false);
              router.push(`/notes/edit?noteId=${note.id}` as any);
            },
          },
          {
            icon: "at-sign",
            label: "Copy reference link",
            sublabel: `@${note.title.toLowerCase().replace(/ /g, "-")}`,
            onPress: () => {},
          },
          { icon: "share-2", label: "Share with team", onPress: () => {} },
          {
            icon: "star",
            label: isBookmarked ? "Remove from favorites" : "Add to favorites",
            onPress: () => {
              setSheetOpen(false);
              toggleBookmark.mutate(noteUrn);
            },
          },
          { icon: "map-pin", label: "Pin to top", onPress: () => {} },
          { icon: "folder", label: "Move to folder", onPress: () => {} },
          { icon: "download", label: "Export as Markdown", onPress: () => {} },
          {
            icon: "trash-2",
            label: "Delete note",
            isDanger: true,
            onPress: () => {
              deleteNote.mutate(note.id);
              setSheetOpen(false);
              router.back();
            },
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  notFound: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", lineHeight: 32 },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  authorName: { fontSize: 13, fontFamily: "Inter_500Medium" },
  editTime: { fontSize: 13, fontFamily: "Inter_400Regular" },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  tagText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  body: { gap: 4 },
  refsSection: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 20, gap: 10 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  refRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  refIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  refTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  actionBar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    paddingBottom: 10,
  },
  actionBtn: { flex: 1, alignItems: "center", gap: 4 },
  actionLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
});
