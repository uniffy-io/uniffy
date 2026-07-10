import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import {
  ArrowLeft,
  TextB,
  TextItalic,
  TextHOne,
  TextHTwo,
  List,
  CheckSquare,
  Quotes,
  Paperclip,
  Eye,
  PencilSimple,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { FONT } from "@/constants/typography";
import { useNote } from "@/hooks/useNotes";
import { useCreateNote, useAutosave } from "@/hooks/useNoteMutations";
import { useAuth } from "@/context/auth-context";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { useMentionInput, toCanonical } from "@/hooks/useMentionInput";

export default function NoteEditorScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { noteId } = useLocalSearchParams<{ noteId?: string }>();
  const { organizationId } = useAuth();
  const isEditMode = !!noteId;

  const noteQuery = useNote(isEditMode ? noteId : undefined);
  const createNote = useCreateNote();
  const autosave = useAutosave(isEditMode ? noteId : undefined, organizationId);

  const {
    displayText: body,
    setDisplayText: setBody,
    selection,
    onSelectionChange: onMentionSelectionChange,
    getCanonical: getCanonicalBody,
    inputRef: bodyRef,
    mentionsRef,
    initFromCanonical,
  } = useMentionInput();

  const [title, setTitle] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());

  // Populate fields when editing an existing note
  useEffect(() => {
    if (isEditMode && noteQuery.data && !initialized) {
      setTitle(noteQuery.data.title);
      initFromCanonical(noteQuery.data.content);
      setInitialized(true);
    }
  }, [isEditMode, noteQuery.data, initialized, initFromCanonical]);

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const handleBodyChange = useCallback(
    (text: string) => {
      setBody(text);
      if (isEditMode) {
        const canonical = toCanonical(text, mentionsRef.current);
        autosave.scheduleAutosave(canonical, title);
      }
    },
    [isEditMode, autosave, title],
  );

  const handleTitleChange = useCallback(
    (text: string) => {
      setTitle(text);
      if (isEditMode && body) {
        const canonical = toCanonical(body, mentionsRef.current);
        autosave.scheduleAutosave(canonical, text);
      }
    },
    [isEditMode, autosave, body],
  );

  const handleDone = useCallback(async () => {
    const canonicalBody = getCanonicalBody();
    if (isEditMode) {
      autosave.flush();
      router.back();
    } else {
      try {
        const response = await createNote.mutateAsync({
          title: title || "Untitled",
          content: canonicalBody,
        });
        const newId = response.note?.id;
        if (newId) {
          router.replace(`/notes/${newId}` as any);
        } else {
          router.back();
        }
      } catch {
        router.back();
      }
    }
  }, [isEditMode, autosave, createNote, title, getCanonicalBody]);

  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;

  const onSelectionChange = useCallback(
    (e: { nativeEvent: { selection: { start: number; end: number } } }) => {
      onMentionSelectionChange(e);
      const sel = e.nativeEvent.selection;

      const textBefore = body.substring(0, sel.start);
      const lineStart = textBefore.lastIndexOf("\n") + 1;
      const lineText = body.substring(
        lineStart,
        body.indexOf("\n", sel.start) === -1 ? body.length : body.indexOf("\n", sel.start),
      );
      const formats = new Set<string>();
      if (lineText.startsWith("## ")) formats.add("h2");
      if (lineText.startsWith("# ")) formats.add("h1");
      if (lineText.startsWith("- [ ] ") || lineText.startsWith("- [x] ")) formats.add("checklist");
      else if (lineText.startsWith("- ")) formats.add("list");
      if (lineText.startsWith("> ")) formats.add("quote");
      const surroundingText = body.substring(Math.max(0, sel.start - 50), sel.start + 50);
      if (surroundingText.includes("**")) formats.add("bold");
      if (/(?<!\*)\*(?!\*)/.test(surroundingText)) formats.add("italic");
      setActiveFormats(formats);
    },
    [body, onMentionSelectionChange],
  );

  const wrapText = useCallback(
    (prefix: string, suffix: string = prefix) => {
      const before = body.substring(0, selection.start);
      const selected = body.substring(selection.start, selection.end);
      const after = body.substring(selection.end);
      const newBody = before + prefix + selected + suffix + after;
      setBody(newBody);
      setTimeout(() => bodyRef.current?.focus(), 50);
    },
    [body, selection],
  );

  const toggleLinePrefix = useCallback(
    (prefix: string) => {
      const textBefore = body.substring(0, selection.start);
      const lineStart = textBefore.lastIndexOf("\n") + 1;
      const lineEnd = body.indexOf("\n", selection.start);
      const end = lineEnd === -1 ? body.length : lineEnd;
      const line = body.substring(lineStart, end);

      let newLine: string;
      if (line.startsWith(prefix)) {
        newLine = line.substring(prefix.length);
      } else {
        const stripped = line.replace(/^(#{1,2} |> |- \[[ x]\] |- )/, "");
        newLine = prefix + stripped;
      }

      const newBody = body.substring(0, lineStart) + newLine + body.substring(end);
      setBody(newBody);
      setTimeout(() => bodyRef.current?.focus(), 50);
    },
    [body, selection],
  );

  // Compute canonical body for preview
  const canonicalBody = useMemo(() => getCanonicalBody(), [getCanonicalBody]);

  const toolbarActions = [
    { key: "bold", Icon: TextB, onPress: () => wrapText("**"), active: activeFormats.has("bold") },
    {
      key: "italic",
      Icon: TextItalic,
      onPress: () => wrapText("*"),
      active: activeFormats.has("italic"),
    },
    {
      key: "h1",
      Icon: TextHOne,
      onPress: () => toggleLinePrefix("# "),
      active: activeFormats.has("h1"),
    },
    {
      key: "h2",
      Icon: TextHTwo,
      onPress: () => toggleLinePrefix("## "),
      active: activeFormats.has("h2"),
    },
    {
      key: "list",
      Icon: List,
      onPress: () => toggleLinePrefix("- "),
      active: activeFormats.has("list"),
    },
    {
      key: "checklist",
      Icon: CheckSquare,
      onPress: () => toggleLinePrefix("- [ ] "),
      active: activeFormats.has("checklist"),
    },
    {
      key: "quote",
      Icon: Quotes,
      onPress: () => toggleLinePrefix("> "),
      active: activeFormats.has("quote"),
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: T.bg, borderBottomColor: T.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ArrowLeft size={20} color={T.text} weight="bold" />
        </TouchableOpacity>
        <View style={styles.headerMeta}>
          <Text style={[styles.headerLabel, { color: T.textDim }]}>
            {isEditMode
              ? autosave.isSaving
                ? "Saving..."
                : autosave.lastSaved
                  ? "Saved"
                  : "Note"
              : "New note"}
          </Text>
          <Text style={[styles.wordCount, { color: T.textDim }]}>{wordCount} words</Text>
        </View>
        <TouchableOpacity
          onPress={() => setPreviewMode((v) => !v)}
          style={[
            styles.previewBtn,
            {
              backgroundColor: previewMode ? T.accentSoft : T.surface,
              borderColor: previewMode ? T.accent : T.border,
            },
          ]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {previewMode ? (
            <PencilSimple size={16} color={T.accent} weight="duotone" />
          ) : (
            <Eye size={16} color={T.textDim} weight="duotone" />
          )}
          <Text style={[styles.previewBtnText, { color: previewMode ? T.accent : T.textDim }]}>
            {previewMode ? "Edit" : "Preview"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.doneBtn, { backgroundColor: T.accent }]}
          onPress={handleDone}
          activeOpacity={0.8}
        >
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>

      {/* Scrollable editor / preview area */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="none"
      >
        {previewMode ? (
          <>
            <Text style={[styles.previewTitle, { color: T.textBright }]}>
              {title || "Untitled"}
            </Text>
            <View style={[styles.divider, { backgroundColor: T.border }]} />
            <MarkdownRenderer content={canonicalBody} />
          </>
        ) : (
          <>
            <TextInput
              value={title}
              onChangeText={handleTitleChange}
              style={[styles.titleInput, { color: T.textBright, borderBottomColor: T.border }]}
              placeholder="Note title..."
              placeholderTextColor={T.textDim}
              multiline
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => bodyRef.current?.focus()}
            />
            <View style={[styles.divider, { backgroundColor: T.border }]} />
            <TextInput
              ref={bodyRef}
              value={body}
              onChangeText={handleBodyChange}
              onSelectionChange={onSelectionChange}
              style={[styles.bodyInput, { color: T.text }]}
              placeholder="Start writing..."
              placeholderTextColor={T.textDim}
              multiline
              textAlignVertical="top"
              scrollEnabled={false}
              autoCorrect
              spellCheck
            />
          </>
        )}
      </ScrollView>

      {/* Toolbar -- only in edit mode, sticks above keyboard */}
      {!previewMode && (
        <View
          style={[
            styles.toolbar,
            {
              backgroundColor: T.bg,
              borderTopColor: T.border,
              paddingBottom: bottomPad > 0 ? bottomPad : 8,
            },
          ]}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.toolbarContent}
            keyboardShouldPersistTaps="always"
          >
            {toolbarActions.map(({ key, Icon, onPress, active }) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.toolBtn,
                  {
                    backgroundColor: active ? T.accent + "22" : T.surface,
                    borderColor: active ? T.accent + "60" : T.border,
                  },
                ]}
                onPress={onPress}
                activeOpacity={0.7}
              >
                <Icon
                  size={16}
                  color={active ? T.accent : T.text}
                  weight={active ? "bold" : "duotone"}
                />
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[styles.toolBtn, { backgroundColor: T.surface, borderColor: T.border }]}
              activeOpacity={0.7}
            >
              <Paperclip size={16} color={T.text} weight="duotone" />
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  backBtn: {},
  headerMeta: {
    flex: 1,
    alignItems: "center",
  },
  headerLabel: {
    fontSize: 13,
    fontFamily: FONT.medium,
  },
  wordCount: {
    fontSize: 11,
    fontFamily: FONT.regular,
    marginTop: 1,
  },
  previewBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  previewBtnText: {
    fontSize: 12,
    fontFamily: FONT.medium,
  },
  doneBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
  },
  doneBtnText: {
    fontSize: 14,
    fontFamily: FONT.semibold,
    color: "#fff",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  titleInput: {
    fontSize: 24,
    fontFamily: FONT.bold,
    lineHeight: 32,
    padding: 0,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 16,
  },
  bodyInput: {
    fontSize: 15,
    fontFamily: FONT.regular,
    lineHeight: 26,
    padding: 0,
    minHeight: 400,
  },
  toolbar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  toolbarContent: {
    paddingHorizontal: 12,
    gap: 6,
    alignItems: "center",
    paddingBottom: 0,
  },
  toolBtn: {
    width: 36,
    height: 36,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  previewTitle: {
    fontSize: 24,
    fontFamily: FONT.bold,
    lineHeight: 32,
    marginBottom: 14,
    paddingBottom: 12,
  },
});
