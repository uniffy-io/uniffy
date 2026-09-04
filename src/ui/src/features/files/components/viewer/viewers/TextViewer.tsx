import { useEffect, useRef, useState } from "react";
import { EditorView, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Spinner } from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { setViewerLoading, setViewerError } from "@/features/files/store/viewerSlice";
import { useFileDownload } from "@/features/files/components/viewer/hooks/useFileDownload";
import type { SerializedFile } from "@/features/files/store/filesThunks";

interface TextViewerProps {
  file: SerializedFile;
}

export function TextViewer({ file }: TextViewerProps) {
  const dispatch = useAppDispatch();
  const { blob, loading: downloadLoading, error: downloadError } = useFileDownload(file.id);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read text content from blob
  useEffect(() => {
    if (!blob) return;

    dispatch(setViewerLoading(true));

    blob
      .text()
      .then((text) => {
        setContent(text);
        dispatch(setViewerLoading(false));
      })
      .catch((err) => {
        setError(err.message);
        dispatch(setViewerLoading(false));
        dispatch(setViewerError(err.message));
      });
  }, [blob, dispatch]);

  // Dispatch download error to viewer state
  useEffect(() => {
    if (downloadError) {
      dispatch(setViewerError(downloadError));
    }
  }, [downloadError, dispatch]);

  useEffect(() => {
    if (!editorRef.current || content === null) return;

    // Clean up previous editor
    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const langDesc = LanguageDescription.matchFilename(languages, file.filename);

    const setupEditor = async () => {
      const extensions = [
        lineNumbers(),
        highlightActiveLine(),
        // Syntax colors from one-dark; the surface itself is the viewer panel
        // showing through, so the editor never brings its own slab.
        syntaxHighlighting(oneDarkHighlightStyle),
        EditorView.editable.of(false),
        EditorView.theme(
          {
            "&": {
              height: "100%",
              fontSize: "13.5px",
              color: "#e8e8ee",
              backgroundColor: "transparent",
            },
            ".cm-scroller": {
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              lineHeight: "1.55",
            },
            ".cm-content": { caretColor: "#e8e8ee" },
            ".cm-gutters": {
              backgroundColor: "transparent",
              color: "rgba(255, 255, 255, 0.35)",
              borderRight: "1px solid rgba(255, 255, 255, 0.08)",
            },
            ".cm-activeLineGutter": { backgroundColor: "rgba(255, 255, 255, 0.05)" },
            ".cm-activeLine": { backgroundColor: "rgba(255, 255, 255, 0.04)" },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
              backgroundColor: "hsl(var(--primary) / 0.3)",
            },
          },
          { dark: true },
        ),
      ];

      // Try to load language support
      if (langDesc) {
        try {
          const langSupport = await langDesc.load();
          extensions.push(langSupport);
        } catch {
          // Language loading failed, continue without syntax highlighting
        }
      }

      const state = EditorState.create({
        doc: content,
        extensions,
      });

      viewRef.current = new EditorView({
        state,
        parent: editorRef.current!,
      });
    };

    setupEditor();

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [content, file.filename]);

  if (downloadLoading || (blob && content === null)) {
    return (
      <div className="viewer-loading">
        <Spinner size={32} className="animate-spin" />
      </div>
    );
  }

  // Check both local error and download error
  const displayError = error || downloadError;
  if (displayError) {
    return (
      <div className="viewer-error">
        <p>{displayError}</p>
      </div>
    );
  }

  return (
    <div className="viewer-text-container">
      <div ref={editorRef} className="h-full" />
    </div>
  );
}
