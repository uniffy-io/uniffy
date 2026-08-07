import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Star, DotsThree, CaretRight, Graph, NotePencil } from "phosphor-react-native";
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
import { useDeleteNote, useUpdateNote } from "@features/notes/useNoteMutations";
import { useNoteBreadcrumb } from "@features/notes/useNotesTree";
import { MoveNoteSheet } from "@features/notes/components/MoveNoteSheet";
import type { MoveTarget } from "@features/notes/components/MoveNoteSheet";
import { NoteIconSheet } from "@features/notes/components/NoteIconSheet";
import { TagPickerSheet } from "@features/tags/components/TagPickerSheet";
import { countWords, parseHeadings, parseOutgoingMentions } from "@features/notes/noteOutline";
import { NoteOutline } from "@features/notes/components/NoteOutline";
import { useAuth } from "@core/providers/AuthContext";
import { useIsBookmarked, useToggleBookmark } from "@features/bookmarks/useBookmarks";
import { NodeType } from "@uniffy/proto/notes/v1/notes_pb";
import { formatRelativeSeconds } from "@shared/lib/dateFormatting";
import { useScreenFocused } from "@shared/hooks/useScreenFocused";
import { useNoteRealtimeSession } from "@features/notes/realtime/useNoteRealtimeSession";
import { useRealtimeMarkdownContent } from "@features/notes/realtime/useMarkdownContent";
import { RealtimePresence } from "@features/notes/realtime/RealtimePresence";

// Leaves the jumped-to heading just below the top edge rather than flush on it.
const HEADING_JUMP_MARGIN = 12;

export function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const auth = useAuth();
  const noteQuery = useNote(id);
  const backlinksQuery = useNoteBacklinks(id);
  const deleteNote = useDeleteNote();
  const updateNote = useUpdateNote();
  const breadcrumb = useNoteBreadcrumb(id);
  const scrollRef = useRef<ScrollView>(null);
  const headingOffsetsRef = useRef(new Map<number, number>());
  const bodyOffsetRef = useRef(0);
  const noteUrn = id ? `urn:uniffy:content:NOTE:${id}` : "";
  const bookmarkQuery = useIsBookmarked(noteUrn);
  const toggleBookmark = useToggleBookmark();
  const isBookmarked = bookmarkQuery.data ?? false;

  // Folders have their own browser; landing here means a deep link resolved to
  // one, so hand it over rather than rendering a note with no body.
  const nodeType = noteQuery.data?.nodeType;
  useEffect(() => {
    if (nodeType === NodeType.FOLDER && id) {
      router.replace(`/notes/folder/${id}` as any);
    }
  }, [nodeType, id]);

  // Live view: read-only doc attach (this screen never writes, and the flag
  // hard-guards VIEWER roles against the server's 4403 write-frame kill).
  // Focus-gated because the edit screen stacks on top and attaches the same
  // doc; two attaches of one docName throw in the multiplexer.
  const isFocused = useScreenFocused();
  const rt = useNoteRealtimeSession({
    noteId: id,
    enabled:
      isFocused &&
      nodeType !== undefined &&
      nodeType !== NodeType.FOLDER &&
      nodeType !== NodeType.CANVAS,
    readOnly: true,
  });
  const liveContent = useRealtimeMarkdownContent(
    rt.session?.ydoc ?? null,
    noteQuery.data?.content || "",
    { whenSynced: rt.session?.whenSynced ?? null, debounceMs: 150 },
  );

  // A canvas keeps serialized board JSON in `content`. Rendering it as markdown
  // would dump raw JSON, and opening it in the markdown editor would corrupt the
  // board on the first keystroke, so both paths are closed off here.
  const isCanvas = noteQuery.data?.nodeType === NodeType.CANVAS;
  // Peer edits stream into the doc; every markdown consumer below reads the
  // live text so the whole screen tracks the session, not the last fetch.
  const content = isCanvas ? noteQuery.data?.content || "" : liveContent;
  // Live peer typing re-renders this screen at the read debounce; the full
  // document parses must not re-run on unrelated renders too.
  const headings = useMemo(() => (isCanvas ? [] : parseHeadings(content)), [isCanvas, content]);
  const outgoing = useMemo(
    () => (isCanvas ? [] : parseOutgoingMentions(content)),
    [isCanvas, content],
  );
  const statistics = useMemo(
    () => `${countWords(content)} words · ${content.length} characters`,
    [content],
  );
  const onHeadingLayout = useCallback((index: number, y: number) => {
    headingOffsetsRef.current.set(index, y);
  }, []);

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
  const editedAt = note.updatedAt ? formatRelativeSeconds(note.updatedAt.seconds) : "just now";
  const backlinks = backlinksQuery.data ?? [];

  // Heading offsets arrive from MarkdownRenderer relative to the body wrapper,
  // so a jump adds the wrapper's own offset within the scroll content.
  const jumpToHeading = (headingIndex: number) => {
    const localY = headingOffsetsRef.current.get(headingIndex);
    if (localY === undefined) return;
    scrollRef.current?.scrollTo({
      y: Math.max(0, bodyOffsetRef.current + localY - HEADING_JUMP_MARGIN),
      animated: true,
    });
  };

  const selectedTagIds = note.tags.map((t) => t.id);

  const toggleTag = (tagId: string) => {
    const next = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((t) => t !== tagId)
      : [...selectedTagIds, tagId];
    updateNote.mutate({ noteId: note.id, tagIds: next });
  };

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Notes"
        color={T.accent}
        icon="notes"
        rightActions={
          <>
            <RealtimePresence session={rt.session} status={rt.status} />
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
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: bottomPad, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {breadcrumb.length > 0 && (
          <View style={styles.breadcrumbRow}>
            {breadcrumb.map((crumb, i) => (
              <React.Fragment key={crumb.id}>
                {i > 0 && <CaretRight size={11} color={T.textDim} weight="bold" />}
                <TouchableOpacity
                  onPress={() => router.push(`/notes/folder/${crumb.id}` as any)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.breadcrumb, { color: T.textDim }]} numberOfLines={1}>
                    {crumb.title}
                  </Text>
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </View>
        )}

        <View style={styles.titleRow}>
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: T.accentSoft }]}
            onPress={() => setIconPickerOpen(true)}
            activeOpacity={0.7}
          >
            {note.icon?.value ? (
              <Text style={styles.iconGlyph}>{note.icon.value}</Text>
            ) : (
              <NotePencil size={20} color={T.accent} weight="duotone" />
            )}
          </TouchableOpacity>
          <Text style={[styles.title, { color: T.textBright }]}>{note.title}</Text>
        </View>

        <View style={styles.authorRow}>
          <Avatar name={authorName} size={24} />
          <Text style={[styles.authorName, { color: T.text }]}>{authorName}</Text>
          <Text style={[styles.editTime, { color: T.textDim }]}>· edited {editedAt}</Text>
        </View>

        <View style={styles.tagsRow}>
          {note.tags.map((tag) => (
            <View key={tag.id} style={[styles.tag, { backgroundColor: tag.color + "22" }]}>
              <Text style={[styles.tagText, { color: tag.color }]}>{tag.name}</Text>
            </View>
          ))}
          <TouchableOpacity
            style={[styles.tagAdd, { borderColor: T.border }]}
            onPress={() => setTagSheetOpen(true)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tagAddText, { color: T.textDim }]}>
              {note.tags.length > 0 ? "Edit tags" : "Add tag"}
            </Text>
          </TouchableOpacity>
        </View>

        <NoteOutline headings={headings} onJump={jumpToHeading} />

        <View
          style={styles.body}
          onLayout={(e) => {
            bodyOffsetRef.current = e.nativeEvent.layout.y;
          }}
        >
          {isCanvas ? (
            <CanvasPlaceholder T={T} />
          ) : (
            <MarkdownRenderer content={content} onHeadingLayout={onHeadingLayout} />
          )}
        </View>

        {outgoing.length > 0 && (
          <View style={[styles.refsSection, { borderTopColor: T.border }]}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>
              REFERENCES {outgoing.length} ITEMS
            </Text>
            <View style={styles.chipsRow}>
              {outgoing.map((link) => (
                <View
                  key={link.urn}
                  style={[styles.linkChip, { backgroundColor: T.surface, borderColor: T.border }]}
                >
                  <Text style={[styles.linkChipText, { color: T.text }]} numberOfLines={1}>
                    {link.label}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

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

        <View style={[styles.refsSection, { borderTopColor: T.border }]}>
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>PROPERTIES</Text>
          <PropertyRow label="Owner" value={authorName} T={T} />
          {note.createdAt ? (
            <PropertyRow
              label="Created"
              value={new Date(note.createdAt.seconds * 1000).toLocaleDateString()}
              T={T}
            />
          ) : null}
          {note.updatedAt ? (
            <PropertyRow
              label="Last updated"
              value={new Date(note.updatedAt.seconds * 1000).toLocaleString()}
              T={T}
            />
          ) : null}
          {!isCanvas && <PropertyRow label="Statistics" value={statistics} T={T} />}
        </View>
      </ScrollView>

      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={note.title}
        subtitle={`${note.outgoingReferences.length} references · ${editedAt}`}
        icon="notes"
        iconColor={T.accent}
        actions={[
          ...(isCanvas
            ? []
            : [
                {
                  icon: "edit-2",
                  label: "Edit note",
                  onPress: () => {
                    setSheetOpen(false);
                    router.push(`/notes/edit?noteId=${note.id}` as any);
                  },
                },
              ]),
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
            icon: "folder",
            label: "Move to...",
            onPress: () => {
              setSheetOpen(false);
              setMoveTarget({
                noteId: note.id,
                noteTitle: note.title,
                currentAccessMode: note.accessMode,
                currentParentId: note.parentId ?? null,
              });
            },
          },
          {
            icon: "star",
            label: isBookmarked ? "Remove from favorites" : "Add to favorites",
            onPress: () => {
              setSheetOpen(false);
              toggleBookmark.mutate(noteUrn);
            },
          },
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

      <MoveNoteSheet target={moveTarget} onClose={() => setMoveTarget(null)} />

      <NoteIconSheet
        visible={iconPickerOpen}
        onClose={() => setIconPickerOpen(false)}
        current={note.icon?.value}
        onSelect={(emoji) => {
          updateNote.mutate({ noteId: note.id, icon: { iconType: "emoji", value: emoji } });
          setIconPickerOpen(false);
        }}
        onClear={() => {
          updateNote.mutate({ noteId: note.id, icon: { iconType: "emoji", value: "" } });
          setIconPickerOpen(false);
        }}
      />

      <TagPickerSheet
        visible={tagSheetOpen}
        onClose={() => setTagSheetOpen(false)}
        selectedIds={selectedTagIds}
        onToggle={toggleTag}
        busy={updateNote.isPending}
      />
    </View>
  );
}

function PropertyRow({
  label,
  value,
  T,
}: {
  label: string;
  value: string;
  T: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={styles.propertyRow}>
      <Text style={[styles.propertyLabel, { color: T.textDim }]}>{label}</Text>
      <Text style={[styles.propertyValue, { color: T.text }]}>{value}</Text>
    </View>
  );
}

function CanvasPlaceholder({ T }: { T: ReturnType<typeof useTheme> }) {
  return (
    <View style={[styles.canvasCard, { backgroundColor: T.surface, borderColor: T.border }]}>
      <View style={[styles.canvasIcon, { backgroundColor: T.accentSoft }]}>
        <Graph size={28} color={T.accent} weight="duotone" />
      </View>
      <Text style={[styles.canvasTitle, { color: T.textBright }]}>This note is a canvas</Text>
      <Text style={[styles.canvasBody, { color: T.textDim }]}>
        Canvas boards need the desktop app. Comments, sharing and bookmarks still work here.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  notFound: { flex: 1, alignItems: "center", justifyContent: "center" },
  canvasCard: {
    alignItems: "center",
    gap: 8,
    padding: 24,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  canvasIcon: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  canvasTitle: { fontSize: 15, fontFamily: FONT.semibold },
  canvasBody: { fontSize: 13, fontFamily: FONT.regular, textAlign: "center", lineHeight: 19 },
  breadcrumbRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  breadcrumb: { fontSize: 12, fontFamily: FONT.medium },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  iconGlyph: { fontSize: 22 },
  title: { flex: 1, fontSize: 24, fontFamily: FONT.bold, lineHeight: 32 },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  authorName: { fontSize: 13, fontFamily: FONT.medium },
  editTime: { fontSize: 13, fontFamily: FONT.regular },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  tagText: { fontSize: 12, fontFamily: FONT.medium },
  tagAdd: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  tagAddText: { fontSize: 12, fontFamily: FONT.medium },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  linkChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 200,
  },
  linkChipText: { fontSize: 12, fontFamily: FONT.medium },
  propertyRow: { flexDirection: "row", justifyContent: "space-between", gap: 16 },
  propertyLabel: { fontSize: 13, fontFamily: FONT.regular },
  propertyValue: { fontSize: 13, fontFamily: FONT.medium, flexShrink: 1, textAlign: "right" },
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
