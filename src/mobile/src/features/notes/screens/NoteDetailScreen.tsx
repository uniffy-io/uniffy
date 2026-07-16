import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Star, DotsThree, CaretRight } from "phosphor-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { CommentButton } from "@shared/comments/CommentsSheet";
import { ShareSheet } from "@shared/permissions/ShareSheet";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { ActionSheet } from "@shared/components/ActionSheet";
import { DOMAIN_ICON } from "@shared/mentions/ReferenceChip";
import { Avatar } from "@shared/components/Avatar";
import { MarkdownRenderer } from "@shared/components/MarkdownRenderer";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useNote, useNoteBacklinks } from "@features/notes/useNotes";
import { useDeleteNote } from "@features/notes/useNoteMutations";
import { useAuth } from "@core/providers/AuthContext";
import { useIsBookmarked, useToggleBookmark } from "@features/bookmarks/useBookmarks";
import { formatRelativeTime } from "@features/notes/noteSerializer";

export function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
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
        <DomainHeader title="Notes" color={T.accent} icon="notes" />
        <View style={styles.notFound}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      </View>
    );
  }

  const note = noteQuery.data;

  if (!note) {
    return (
      <View style={[styles.container, { backgroundColor: T.pageBg }]}>
        <DomainHeader title="Notes" color={T.accent} icon="notes" />
        <View style={styles.notFound}>
          <Text style={{ color: T.textDim }}>Note not found</Text>
        </View>
      </View>
    );
  }

  const authorName = note.ownerInfo?.name || auth.user?.fullName || "Unknown";
  const editedAt = note.updatedAt ? formatRelativeTime(note.updatedAt.seconds) : "just now";
  const backlinks = backlinksQuery.data ?? [];

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Notes"
        color={T.accent}
        icon="notes"
        rightActions={
          <>
            <CommentButton contentType={ContentType.NOTE} contentId={note.id} color={T.accent} />
            <TouchableOpacity
              onPress={() => toggleBookmark.mutate(noteUrn)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Star
                key={isBookmarked ? "fill" : "duotone"}
                size={19}
                color={isBookmarked ? T.accent : T.textDim}
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
        contentContainerStyle={{ padding: 20, paddingBottom: bottomPad, gap: 16 }}
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
              const RefIcon = DOMAIN_ICON["notes"];
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.refRow, { backgroundColor: T.surface, borderColor: T.border }]}
                  onPress={() => router.push(`/notes/${ref.id}` as any)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.refIcon, { backgroundColor: T.accentSoft }]}>
                    <RefIcon size={14} color={T.accent} weight="bold" />
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

      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={note.title}
        subtitle={`${note.outgoingReferences.length} references · ${editedAt}`}
        icon="notes"
        iconColor={T.accent}
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
            onPress: () => {
              Clipboard.setStringAsync(noteUrn);
              Alert.alert("Copied", "Reference link copied to clipboard.");
            },
          },
          { icon: "share-2", label: "Share with team", onPress: () => setShareOpen(true) },
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

      <ShareSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        contentType={ContentType.NOTE}
        contentId={note.id}
        color={T.accent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  notFound: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontFamily: FONT.bold, lineHeight: 32 },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  authorName: { fontSize: 13, fontFamily: FONT.medium },
  editTime: { fontSize: 13, fontFamily: FONT.regular },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  tagText: { fontSize: 12, fontFamily: FONT.medium },
  body: { gap: 4 },
  refsSection: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 20, gap: 10 },
  sectionLabel: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.8 },
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
  refTitle: { fontSize: 13, fontFamily: FONT.semibold },
});
