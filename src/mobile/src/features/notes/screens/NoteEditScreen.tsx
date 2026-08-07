import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from "react-native";
import {
  ArrowLeft,
  At,
  LinkSimple,
  TextB,
  TextItalic,
  TextStrikethrough,
  Highlighter,
  Code,
  CodeBlock,
  TextHOne,
  TextHTwo,
  TextHThree,
  TextHFour,
  ListBullets,
  ListNumbers,
  CheckSquare,
  Quotes,
  Minus,
  Paperclip,
  Eye,
  PencilSimple,
} from "phosphor-react-native";
import type { IconProps } from "phosphor-react-native";
import type { TextStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useNote } from "@features/notes/useNotes";
import { NodeType } from "@uniffy/proto/notes/v1/notes_pb";
import { useCreateNote, useAutosave } from "@features/notes/useNoteMutations";
import { useAuth } from "@core/providers/AuthContext";
import { useUniffy } from "@core/providers/UniffyContext";
import { MarkdownRenderer } from "@shared/components/MarkdownRenderer";
import { useMentionInput, toCanonical } from "@shared/mentions/useMentionInput";
import { useInsertFileReference } from "@features/mentions/useInsertFileReference";
import {
  tokenizeLine,
  inlineActiveAt,
  isContentKind,
  type InlineFormat,
  type InlineKind,
} from "@shared/lib/markdownInline";

type ToolAction = {
  key: string;
  Icon: React.ComponentType<IconProps>;
  onPress: () => void;
  loading?: boolean;
  active?: boolean;
};

type ThemeColors = ReturnType<typeof useTheme>;

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

// Block-level markdown prefixes the line toggler recognises, longest-first so
// "- [ ] " wins over "- ". Covers headings H1-H6, quote, checklist, bullet,
// and numbered lists.
const BLOCK_PREFIX_RE = /^(#{1,6} |> |- \[[ x]\] |- |\d+\. )/;
const HEADING_PREFIX_RE = /^#{1,6} /;
const LIST_PREFIX_RE = /^(- \[[ x]\] |- |\d+\. )/;

// The live-styled editor keeps every character at one font size and line height
// so the native caret stays aligned; formatting is conveyed by weight, style,
// colour, and background only (never a size change), and markdown markers are
// dimmed rather than hidden.
function styleForKind(kind: InlineKind, T: ThemeColors): TextStyle | null {
  switch (kind) {
    case "marker":
      return { color: T.textDim };
    case "bold":
      return { fontFamily: FONT.bold, color: T.textBright };
    case "italic":
      return { fontStyle: "italic" };
    case "bolditalic":
      return { fontFamily: FONT.bold, fontStyle: "italic", color: T.textBright };
    case "strike":
      return { textDecorationLine: "line-through", color: T.textDim };
    case "highlight":
      return { backgroundColor: T.yellow + "33", color: T.textBright };
    case "code":
      return { fontFamily: MONO, color: T.textBright, backgroundColor: T.surfaceHover };
    default:
      return null;
  }
}

function renderLineNodes(
  line: string,
  li: number,
  T: ThemeColors,
  caretInLine: number,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let base: TextStyle | null = null;
  let prefixLen = 0;
  const heading = line.match(HEADING_PREFIX_RE);
  if (heading) {
    base = { fontFamily: FONT.bold, color: T.textBright };
    prefixLen = heading[0].length;
  } else if (line.startsWith("> ")) {
    base = { fontStyle: "italic", color: T.textDim };
    prefixLen = 2;
  } else {
    const list = line.match(LIST_PREFIX_RE);
    if (list) prefixLen = list[0].length;
  }

  if (prefixLen > 0) {
    nodes.push(
      <Text key={`l${li}p`} style={{ color: T.textDim }}>
        {line.slice(0, prefixLen)}
      </Text>,
    );
  }

  const content = line.slice(prefixLen);
  if (content.length === 0) return nodes;

  // The inline span the caret sits inside is "active": hide its flanking markers
  // by rendering them transparent (not zero-width - that froze Android), so the
  // symbols vanish with no layout shift while you type in that span. Every other
  // span keeps its dim markers.
  const segs = tokenizeLine(content);
  const contentCaret = caretInLine >= 0 ? caretInLine - prefixLen : -1;
  let activeIdx = -1;
  if (contentCaret >= 0) {
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (isContentKind(s.kind) && contentCaret >= s.start && contentCaret <= s.end) {
        activeIdx = i;
        break;
      }
    }
  }

  segs.forEach((seg, si) => {
    const hidden = seg.kind === "marker" && (si === activeIdx - 1 || si === activeIdx + 1);
    const kindStyle: TextStyle | null = hidden
      ? { color: "transparent" }
      : styleForKind(seg.kind, T);
    const merged = [base, kindStyle].filter(Boolean) as TextStyle[];
    nodes.push(
      <Text key={`l${li}s${si}`} style={merged.length ? merged : undefined}>
        {seg.text}
      </Text>,
    );
  });
  return nodes;
}

// Styled children for the body TextInput. Their concatenated text must equal the
// raw markdown value exactly (newlines included) so selection offsets stay 1:1.
// `caret` is the collapsed cursor position (or -1) so the active span's markers
// can be hidden as it moves.
function renderStyledBody(body: string, T: ThemeColors, caret: number): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let offset = 0;
  body.split("\n").forEach((line, li) => {
    if (li > 0) out.push(<Text key={`nl${li}`}>{"\n"}</Text>);
    const caretInLine = caret >= offset && caret <= offset + line.length ? caret - offset : -1;
    for (const node of renderLineNodes(line, li, T, caretInLine)) out.push(node);
    offset += line.length + 1;
  });
  return out;
}

export function NoteEditorScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { noteId, parentId, accessMode, initialTitle, initialContent } = useLocalSearchParams<{
    noteId?: string;
    parentId?: string;
    accessMode?: string;
    initialTitle?: string;
    initialContent?: string;
  }>();
  const { organizationId } = useAuth();
  const { openAt } = useUniffy();
  const { attach: attachFile, uploading: attachUploading } = useInsertFileReference();
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

  // Scroll sync between the raw editor and the rendered preview. Their heights
  // differ (markdown source vs rendered layout), so we carry the position as a
  // fraction and map it onto the other view's content instead of a raw offset.
  const editorScrollRef = useRef<ScrollView>(null);
  const previewScrollRef = useRef<ScrollView>(null);
  const editorScrollY = useRef(0);
  const editorContentH = useRef(0);
  const previewScrollY = useRef(0);
  const previewContentH = useRef(0);
  const viewportH = useRef(0);
  const previewFraction = useRef(0);
  const previewSyncPending = useRef(false);

  const scrollFraction = (offset: number, contentH: number) =>
    Math.min(1, Math.max(0, offset / Math.max(1, contentH - viewportH.current)));

  // A canvas stores board JSON in `content` and a folder has no body at all;
  // either one loaded here would let the first keystroke autosave markdown over
  // a node that is not a markdown note.
  const isCanvas = noteQuery.data?.nodeType === NodeType.CANVAS;
  const isFolder = noteQuery.data?.nodeType === NodeType.FOLDER;
  useEffect(() => {
    if (!noteId) return;
    if (isCanvas) router.replace(`/notes/${noteId}` as any);
    else if (isFolder) router.replace(`/notes/folder/${noteId}` as any);
  }, [isCanvas, isFolder, noteId]);

  // Populate fields when editing an existing note, or seed them when a caller
  // pre-fills a new one (a project note opens with the project @-mentioned).
  const loadedRef = useRef<{ title: string; content: string } | null>(null);
  useEffect(() => {
    if (initialized || isCanvas || isFolder) return;
    if (isEditMode) {
      if (!noteQuery.data) return;
      setTitle(noteQuery.data.title);
      initFromCanonical(noteQuery.data.content);
      loadedRef.current = { title: noteQuery.data.title, content: noteQuery.data.content };
      setInitialized(true);
      return;
    }
    if (initialTitle) setTitle(initialTitle);
    if (initialContent) initFromCanonical(initialContent);
    setInitialized(true);
  }, [
    isEditMode,
    noteQuery.data,
    initialized,
    initFromCanonical,
    initialTitle,
    initialContent,
    isCanvas,
    isFolder,
  ]);

  const headerTopPad = (Platform.OS === "web" ? 20 : insets.top) + 12;
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  // Autosave on any content change. Typing, formatting, and @-reference
  // insertion all funnel through body/title, so watching them here keeps the
  // mention path saved without a per-edit handler.
  useEffect(() => {
    if (!isEditMode || !initialized) return;
    const canonical = toCanonical(body, mentionsRef.current);
    const loaded = loadedRef.current;
    if (loaded && canonical === loaded.content && title === loaded.title) return;
    autosave.scheduleAutosave(canonical, title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, title, isEditMode, initialized]);

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
          parentId,
          accessMode: accessMode ? Number(accessMode) : undefined,
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
  }, [isEditMode, autosave, createNote, title, getCanonicalBody, parentId, accessMode]);

  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;

  const caretRestore = useCallback(
    (start: number, end: number = start) => {
      setTimeout(() => {
        bodyRef.current?.focus();
        bodyRef.current?.setSelection(start, end);
      }, 50);
    },
    [bodyRef],
  );

  // Sticky inline toggle: with a selection it wraps (or unwraps) it; with a bare
  // caret it opens a marker pair and drops the caret inside so the button stays
  // lit and typed text renders formatted live. Pressing an already-active toggle
  // exits past the closing marker, removing the pair if nothing was typed.
  const toggleInline = useCallback(
    (marker: string, format: InlineFormat) => {
      const { start, end } = selection;
      if (start !== end) {
        const selected = body.slice(start, end);
        const wrapped =
          body.slice(start - marker.length, start) === marker &&
          body.slice(end, end + marker.length) === marker;
        if (wrapped) {
          setBody(
            body.slice(0, start - marker.length) + selected + body.slice(end + marker.length),
          );
          caretRestore(start - marker.length, end - marker.length);
        } else {
          setBody(body.slice(0, start) + marker + selected + marker + body.slice(end));
          caretRestore(start + marker.length, end + marker.length);
        }
        return;
      }

      const active = inlineActiveAt(body, start);
      if (active.flags[format]) {
        const empty = active.emptyRange[format];
        if (empty) {
          setBody(body.slice(0, empty.open) + body.slice(empty.close));
          caretRestore(empty.open);
        } else {
          caretRestore(active.ends[format] ?? start);
        }
        return;
      }
      setBody(body.slice(0, start) + marker + marker + body.slice(start));
      caretRestore(start + marker.length);
    },
    [body, selection, setBody, caretRestore],
  );

  // Rewrite the caret's current line and drop the caret past the new prefix, so
  // typed text lands inside the list/quote/heading and the formatting applies.
  const editCurrentLine = useCallback(
    (transform: (line: string) => { newLine: string; caretPrefixLen: number }) => {
      const textBefore = body.substring(0, selection.start);
      const lineStart = textBefore.lastIndexOf("\n") + 1;
      const lineEnd = body.indexOf("\n", selection.start);
      const end = lineEnd === -1 ? body.length : lineEnd;
      const line = body.substring(lineStart, end);

      const { newLine, caretPrefixLen } = transform(line);
      setBody(body.substring(0, lineStart) + newLine + body.substring(end));

      const delta = newLine.length - line.length;
      const caret = Math.max(lineStart + caretPrefixLen, selection.start + delta);
      setTimeout(() => {
        bodyRef.current?.focus();
        bodyRef.current?.setSelection(caret, caret);
      }, 50);
    },
    [body, selection, setBody, bodyRef],
  );

  const toggleLinePrefix = useCallback(
    (prefix: string) =>
      editCurrentLine((line) => {
        const existing = line.match(BLOCK_PREFIX_RE)?.[0] ?? "";
        const stripped = line.slice(existing.length);
        // Same prefix already present -> toggle it off; any other block prefix ->
        // swap it (e.g. H1 to H2, bullet to numbered).
        const newPrefix = existing === prefix ? "" : prefix;
        return { newLine: newPrefix + stripped, caretPrefixLen: newPrefix.length };
      }),
    [editCurrentLine],
  );

  // The checklist button cycles the line: none -> unchecked -> checked -> none.
  // This keeps "- [x] " well-formed instead of the user typing an x into the
  // "- [ ] " box and leaving a stray space.
  const cycleChecklist = useCallback(
    () =>
      editCurrentLine((line) => {
        if (line.startsWith("- [ ] ")) {
          return { newLine: "- [x] " + line.slice(6), caretPrefixLen: 6 };
        }
        if (line.startsWith("- [x] ")) {
          return { newLine: line.slice(6), caretPrefixLen: 0 };
        }
        const existing = line.match(BLOCK_PREFIX_RE)?.[0] ?? "";
        return { newLine: "- [ ] " + line.slice(existing.length), caretPrefixLen: 6 };
      }),
    [editCurrentLine],
  );

  // Replace the current selection with `insert` and place the caret/selection at
  // an absolute range; the shared path for link/code-block/rule insertion.
  const replaceSelection = useCallback(
    (insert: string, selStart: number, selEnd: number = selStart) => {
      const pre = body.substring(0, selection.start);
      const post = body.substring(selection.end);
      setBody(pre + insert + post);
      setTimeout(() => {
        bodyRef.current?.focus();
        bodyRef.current?.setSelection(selStart, selEnd);
      }, 50);
    },
    [body, selection, setBody, bodyRef],
  );

  const insertLink = useCallback(() => {
    const selected = body.substring(selection.start, selection.end);
    const label = selected || "text";
    const insert = `[${label}](url)`;
    const urlStart = selection.start + label.length + 3; // past "[label]("
    replaceSelection(insert, urlStart, urlStart + 3); // preselect "url"
  }, [body, selection, replaceSelection]);

  const insertCodeBlock = useCallback(() => {
    const pre = body.substring(0, selection.start);
    const selected = body.substring(selection.start, selection.end);
    const lead = pre.length > 0 && !pre.endsWith("\n") ? "\n" : "";
    const insert = `${lead}\`\`\`\n${selected}\n\`\`\`\n`;
    const caret = selection.start + lead.length + 4 + selected.length; // on the code line
    replaceSelection(insert, caret);
  }, [body, selection, replaceSelection]);

  const insertRule = useCallback(() => {
    const pre = body.substring(0, selection.start);
    const lead = pre.length > 0 && !pre.endsWith("\n") ? "\n" : "";
    const insert = `${lead}---\n`;
    replaceSelection(insert, selection.start + insert.length);
  }, [body, selection, replaceSelection]);

  // Compute canonical body for preview
  const canonicalBody = useMemo(() => getCanonicalBody(), [getCanonicalBody]);

  const togglePreview = useCallback(() => {
    if (!previewMode) {
      // Entering preview: remember where we are, apply once the preview measures.
      previewFraction.current = scrollFraction(editorScrollY.current, editorContentH.current);
      previewSyncPending.current = true;
    } else {
      // Returning to edit: map the preview position back onto the editor.
      const target =
        scrollFraction(previewScrollY.current, previewContentH.current) *
        Math.max(0, editorContentH.current - viewportH.current);
      editorScrollY.current = target;
      setTimeout(() => editorScrollRef.current?.scrollTo({ y: target, animated: false }), 0);
    }
    setPreviewMode((v) => !v);
  }, [previewMode]);

  // Active toggle state. A collapsed caret reads the enclosing inline spans; a
  // range lights a format only when the whole selection is already wrapped.
  const caretCollapsed = selection.start === selection.end;
  const activeCaret = caretCollapsed ? selection.start : -1;
  const editorChildren = useMemo(
    () => renderStyledBody(body, T, activeCaret),
    [body, T, activeCaret],
  );
  const inlineActive = useMemo(() => inlineActiveAt(body, activeCaret), [body, activeCaret]);
  const isSelWrapped = useCallback(
    (marker: string) =>
      !caretCollapsed &&
      body.slice(selection.start - marker.length, selection.start) === marker &&
      body.slice(selection.end, selection.end + marker.length) === marker,
    [body, selection, caretCollapsed],
  );
  const inlineOn = (marker: string, format: InlineFormat) =>
    caretCollapsed ? inlineActive.flags[format] : isSelWrapped(marker);

  const linePrefix = useMemo(() => {
    const caret = selection.start;
    const lineStart = body.lastIndexOf("\n", caret - 1) + 1;
    let lineEnd = body.indexOf("\n", caret);
    if (lineEnd === -1) lineEnd = body.length;
    return body.slice(lineStart, lineEnd).match(BLOCK_PREFIX_RE)?.[0] ?? "";
  }, [body, selection]);

  const toolbarActions: ToolAction[] = [
    { key: "mention", Icon: At, onPress: () => openAt(true) },
    { key: "link", Icon: LinkSimple, onPress: insertLink },
    {
      key: "bold",
      Icon: TextB,
      onPress: () => toggleInline("**", "bold"),
      active: inlineOn("**", "bold"),
    },
    {
      key: "italic",
      Icon: TextItalic,
      onPress: () => toggleInline("*", "italic"),
      active: inlineOn("*", "italic"),
    },
    {
      key: "strike",
      Icon: TextStrikethrough,
      onPress: () => toggleInline("~~", "strike"),
      active: inlineOn("~~", "strike"),
    },
    {
      key: "highlight",
      Icon: Highlighter,
      onPress: () => toggleInline("==", "highlight"),
      active: inlineOn("==", "highlight"),
    },
    {
      key: "code",
      Icon: Code,
      onPress: () => toggleInline("`", "code"),
      active: inlineOn("`", "code"),
    },
    { key: "codeblock", Icon: CodeBlock, onPress: insertCodeBlock },
    {
      key: "h1",
      Icon: TextHOne,
      onPress: () => toggleLinePrefix("# "),
      active: linePrefix === "# ",
    },
    {
      key: "h2",
      Icon: TextHTwo,
      onPress: () => toggleLinePrefix("## "),
      active: linePrefix === "## ",
    },
    {
      key: "h3",
      Icon: TextHThree,
      onPress: () => toggleLinePrefix("### "),
      active: linePrefix === "### ",
    },
    {
      key: "h4",
      Icon: TextHFour,
      onPress: () => toggleLinePrefix("#### "),
      active: linePrefix === "#### ",
    },
    {
      key: "bullet",
      Icon: ListBullets,
      onPress: () => toggleLinePrefix("- "),
      active: linePrefix === "- ",
    },
    {
      key: "numbered",
      Icon: ListNumbers,
      onPress: () => toggleLinePrefix("1. "),
      active: /^\d+\. $/.test(linePrefix),
    },
    {
      key: "checklist",
      Icon: CheckSquare,
      onPress: cycleChecklist,
      active: linePrefix === "- [ ] " || linePrefix === "- [x] ",
    },
    {
      key: "quote",
      Icon: Quotes,
      onPress: () => toggleLinePrefix("> "),
      active: linePrefix === "> ",
    },
    { key: "rule", Icon: Minus, onPress: insertRule },
    { key: "attach", Icon: Paperclip, onPress: attachFile, loading: attachUploading },
  ];

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg, paddingBottom: bottomPad }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: T.bg, borderBottomColor: T.border, paddingTop: headerTopPad },
        ]}
      >
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
          onPress={togglePreview}
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

      {/* The editor stays mounted while previewing, so its focused input keeps
          the keyboard up; the preview renders as an overlay on top of it. */}
      <View
        style={styles.editorArea}
        onLayout={(e) => {
          viewportH.current = e.nativeEvent.layout.height;
        }}
      >
        <ScrollView
          ref={editorScrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="none"
          scrollEventThrottle={16}
          onScroll={(e) => {
            editorScrollY.current = e.nativeEvent.contentOffset.y;
          }}
          onContentSizeChange={(_w, h) => {
            editorContentH.current = h;
          }}
        >
          <TextInput
            value={title}
            onChangeText={setTitle}
            style={[styles.titleInput, { color: T.textBright }]}
            placeholder="Note title..."
            placeholderTextColor={T.textDim}
            multiline
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => bodyRef.current?.focus()}
          />
          <View style={[styles.divider, { backgroundColor: T.border }]} />
          {/* Children carry the styled content, so we cannot also pass `value`
              (RN forbids both). The input stays controlled through onChangeText
              plus our programmatic setBody, and the children mirror body exactly
              so the caret stays aligned. */}
          <TextInput
            ref={bodyRef}
            onChangeText={setBody}
            onSelectionChange={onMentionSelectionChange}
            style={[styles.bodyInput, { color: T.text }]}
            placeholder="Start writing..."
            placeholderTextColor={T.textDim}
            multiline
            textAlignVertical="top"
            scrollEnabled={false}
            autoCorrect
            spellCheck
          >
            {editorChildren}
          </TextInput>
        </ScrollView>

        {previewMode && (
          <ScrollView
            ref={previewScrollRef}
            style={[styles.previewOverlay, { backgroundColor: T.pageBg }]}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: 24 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => {
              previewScrollY.current = e.nativeEvent.contentOffset.y;
            }}
            onContentSizeChange={(_w, h) => {
              previewContentH.current = h;
              // Land at the editor's position the first time the preview measures.
              if (previewSyncPending.current) {
                previewSyncPending.current = false;
                const target = previewFraction.current * Math.max(0, h - viewportH.current);
                previewScrollY.current = target;
                previewScrollRef.current?.scrollTo({ y: target, animated: false });
              }
            }}
          >
            <Text style={[styles.previewTitle, { color: T.textBright }]}>
              {title || "Untitled"}
            </Text>
            <View style={[styles.divider, { backgroundColor: T.border }]} />
            <MarkdownRenderer content={canonicalBody} />
          </ScrollView>
        )}
      </View>

      {/* Formatting toolbar sits above the keyboard in both edit and preview,
          so switching modes never shifts the keyboard frame. */}
      <View
        style={[
          styles.toolbar,
          {
            backgroundColor: T.bg,
            borderTopColor: T.border,
            paddingBottom: 8,
          },
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.toolbarContent}
          keyboardShouldPersistTaps="always"
        >
          {toolbarActions.map(({ key, Icon, onPress, loading, active }) => (
            <TouchableOpacity
              key={key}
              style={[
                styles.toolBtn,
                {
                  backgroundColor: active ? T.accentSoft : T.surface,
                  borderColor: active ? T.accent : T.border,
                },
              ]}
              onPress={onPress}
              disabled={loading}
              activeOpacity={0.7}
            >
              {loading ? (
                <ActivityIndicator size="small" color={T.text} />
              ) : (
                <Icon size={16} color={active ? T.accent : T.text} weight="duotone" />
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
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
  editorArea: {
    flex: 1,
  },
  previewOverlay: {
    ...StyleSheet.absoluteFill,
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
