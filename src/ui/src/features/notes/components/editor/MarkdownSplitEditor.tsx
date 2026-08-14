import { useRef, useEffect, useCallback, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { sanitizeMentionLabel } from "@/shared/utils/mentionUtils";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultKeymap } from "@codemirror/commands";
import { useAppSelector } from "@/app/hooks";
import { CrepeEditor, type CrepeRealtimeBinding } from "@/components/editor/CrepeEditor";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import type { SerializedNote } from "@/features/notes/store/notesThunks";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { MarkdownMentionSearch } from "@/components/editor/plugins/mention/MarkdownMentionSearch";
import type { SearchResultItem } from "@uniffy/proto/search/v1/search_pb";
import { useTheme } from "@/config/theme/ThemeProvider";
import { createMarkdownEditorTheme } from "@/features/notes/components/editor/markdownEditorTheme";
import { useRealtimeMarkdownContent } from "@/features/notes/realtime/useMarkdownContent";
import { replaceMarkdownYText } from "@/features/notes/realtime/markdown";

interface MarkdownSplitEditorProps {
  note: SerializedNote;
  titleSlot?: ReactNode;
  // Both panes share Y.Text("markdown") so editor + preview cannot drift.
  realtime?: CrepeRealtimeBinding;
}

const MIN_PANE_WIDTH = 200;

const defaultSettings = {
  editorMode: "markdown" as const,
  showMarkdownPreview: true,
  showMarkdownLineNumbers: true,
  fontSize: 16,
  lineHeight: 1.6,
  spellCheck: true,
};

export function MarkdownSplitEditor({ note, titleSlot, realtime }: MarkdownSplitEditorProps) {
  const editorState = useAppSelector((state) => state.editor);
  const settings = editorState?.settings ?? defaultSettings;
  const showMarkdownPreview = settings.showMarkdownPreview ?? true;
  const showLineNumbers = settings.showMarkdownLineNumbers ?? true;
  const { isMobile } = useBreakpoint();
  const { resolvedTheme } = useTheme();
  const stackVertically = isMobile && showMarkdownPreview;

  // Preview rebuilds Milkdown per value change - debounce so a typing peer does not thrash it.
  const whenSynced = realtime?.whenSynced ?? null;
  const content = useRealtimeMarkdownContent(realtime?.ydoc ?? null, note.content, {
    whenSynced,
  });
  const previewContent = useRealtimeMarkdownContent(realtime?.ydoc ?? null, note.content, {
    whenSynced,
    debounceMs: 300,
  });

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const codemirrorViewRef = useRef<EditorView | null>(null);
  const themeCompartmentRef = useRef<Compartment>(new Compartment());

  const containerRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isDragging, setIsDragging] = useState(false);

  // Track `@` position so we know what range to overwrite with `[[[label|urn]]]`.
  const [mentionPopup, setMentionPopup] = useState<{
    triggerFrom: number;
    triggerTo: number;
    query: string;
  } | null>(null);
  // The textarea handlers below stay identity-stable so a re-render never
  // remounts them mid-keystroke; current values reach them through these refs.
  /* eslint-disable react/react-compiler -- latest-value refs for stable textarea handlers */
  const mentionPopupRef = useRef(mentionPopup);
  mentionPopupRef.current = mentionPopup;

  const realtimeRef = useRef(realtime);
  realtimeRef.current = realtime;
  /* eslint-enable react/react-compiler */

  const handleContentChange = useCallback((newContent: string) => {
    const rt = realtimeRef.current;
    if (!rt) return;
    replaceMarkdownYText(rt.ydoc, newContent, rt.sessionId);
  }, []);

  const handleMentionSelect = useCallback((result: SearchResultItem) => {
    const popup = mentionPopupRef.current;
    const view = codemirrorViewRef.current;
    if (!popup || !view) {
      setMentionPopup(null);
      return;
    }
    // Extend replace range over any partial query typed before popup focus (e.g. "@fo").
    const doc = view.state.doc;
    let to = popup.triggerTo;
    while (to < doc.length) {
      const ch = doc.sliceString(to, to + 1);
      if (!ch || /\s/.test(ch)) break;
      to += 1;
    }
    const label = sanitizeMentionLabel(result.title || "Untitled");
    const insertion = `[[[${label}|${result.urn}]]] `;
    view.dispatch({
      changes: { from: popup.triggerFrom, to, insert: insertion },
      selection: { anchor: popup.triggerFrom + insertion.length },
    });
    setMentionPopup(null);
    view.focus();
  }, []);

  const handleMentionClose = useCallback(() => {
    setMentionPopup(null);
    codemirrorViewRef.current?.focus();
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const mouseX = e.clientX - containerRect.left;

      const minRatio = MIN_PANE_WIDTH / containerWidth;
      const maxRatio = 1 - minRatio;
      const newRatio = Math.max(minRatio, Math.min(maxRatio, mouseX / containerWidth));

      setSplitRatio(newRatio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (!editorContainerRef.current) return;

    if (codemirrorViewRef.current) {
      codemirrorViewRef.current.destroy();
      codemirrorViewRef.current = null;
    }

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        markdown({ codeLanguages: languages }),
        keymap.of(defaultKeymap),
        themeCompartmentRef.current.of(
          createMarkdownEditorTheme({
            isDark: resolvedTheme === "dark",
            fontSize: settings?.fontSize || 16,
            lineHeight: settings?.lineHeight || 1.6,
            showLineNumbers,
            isMobile,
          }),
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newContent = update.state.doc.toString();
            handleContentChange(newContent);
          }
          // After-change detection avoids races with beforeinput.
          if (update.docChanged && !mentionPopupRef.current) {
            update.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
              if (inserted.length !== 1 || inserted.sliceString(0) !== "@") return;
              const doc = update.state.doc;
              const charBefore = fromB > 0 ? doc.sliceString(fromB - 1, fromB) : "";
              const atWordBoundary = !charBefore || /\s/.test(charBefore);
              if (!atWordBoundary) return;
              setMentionPopup({ triggerFrom: fromB, triggerTo: fromB + 1, query: "" });
            });
          }
        }),
      ],
    });

    codemirrorViewRef.current = new EditorView({
      state,
      parent: editorContainerRef.current,
    });

    return () => {
      if (codemirrorViewRef.current) {
        codemirrorViewRef.current.destroy();
        codemirrorViewRef.current = null;
      }
    };
    // Re-init only on note swap; theme + sizing live in a Compartment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  useEffect(() => {
    const view = codemirrorViewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartmentRef.current.reconfigure(
        createMarkdownEditorTheme({
          isDark: resolvedTheme === "dark",
          fontSize: settings?.fontSize || 16,
          lineHeight: settings?.lineHeight || 1.6,
          showLineNumbers,
          isMobile,
        }),
      ),
    });
  }, [resolvedTheme, settings?.fontSize, settings?.lineHeight, showLineNumbers, isMobile]);

  useEffect(() => {
    if (!codemirrorViewRef.current) return;

    const currentContent = codemirrorViewRef.current.state.doc.toString();
    if (currentContent !== content) {
      codemirrorViewRef.current.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: content,
        },
      });
    }
  }, [content]);

  return (
    <div className="flex flex-col h-full">
      <div
        ref={containerRef}
        className={`flex-1 overflow-hidden relative ${stackVertically ? "flex flex-col" : "flex"}`}
      >
        <div
          className="overflow-hidden"
          style={
            stackVertically
              ? { height: showMarkdownPreview ? "50%" : "100%", width: "100%" }
              : { width: showMarkdownPreview ? `${splitRatio * 100}%` : "100%", height: "100%" }
          }
        >
          <div ref={editorContainerRef} className="h-full" />
        </div>

        {showMarkdownPreview && !stackVertically && (
          <div
            onMouseDown={handleMouseDown}
            className={`
              w-1 h-full cursor-col-resize flex-shrink-0 relative group
              ${isDragging ? "bg-primary" : "bg-border hover:bg-primary/50"}
              transition-colors
            `}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
            <div
              className={`
                absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                w-1 h-8 rounded-full
                ${isDragging ? "bg-primary-foreground" : "bg-transparent group-hover:bg-primary"}
                transition-colors
              `}
            />
          </div>
        )}

        {showMarkdownPreview && stackVertically && (
          <div className="h-px w-full bg-border flex-shrink-0" />
        )}

        {showMarkdownPreview && (
          <div
            className="overflow-hidden"
            style={
              stackVertically
                ? { height: "50%", width: "100%" }
                : { width: `${(1 - splitRatio) * 100}%`, height: "100%" }
            }
          >
            <CrepeEditor
              contentType={ContentType.NOTE}
              contentId={note.id}
              value={previewContent}
              readonly
              enableUpload={false}
              headerSlot={titleSlot}
            />
          </div>
        )}

        {isDragging && <div className="absolute inset-0 cursor-col-resize z-50" />}
      </div>

      {mentionPopup &&
        createPortal(
          <MarkdownMentionSearch
            initialQuery={mentionPopup.query}
            onSelect={handleMentionSelect}
            onClose={handleMentionClose}
          />,
          document.body,
        )}
    </div>
  );
}
