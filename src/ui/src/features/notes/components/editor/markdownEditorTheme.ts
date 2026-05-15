import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

interface MarkdownEditorThemeOptions {
  isDark: boolean;
  fontSize: number;
  lineHeight: number;
  showLineNumbers: boolean;
  isMobile: boolean;
}

/**
 * Build the CodeMirror theme for the Markdown source editor.
 *
 * Pulls every color from the app's CSS variables so the editor stays in lock
 * step with the active theme (and the user's accent). Returns a combined
 * extension array so the caller can hand it to a `Compartment` and reconfigure
 * on theme / setting changes without rebuilding the editor.
 */
export function createMarkdownEditorTheme({
  isDark,
  fontSize,
  lineHeight,
  showLineNumbers,
  isMobile,
}: MarkdownEditorThemeOptions): Extension[] {
  // Editor surface mirrors the app header (`--card`), not the deeper
  // `--background` shade used for the app shell. Otherwise the markdown pane
  // reads as a black void next to the rest of the UI.
  const bg = 'hsl(var(--card))';
  const fg = 'hsl(var(--foreground))';
  const muted = 'hsl(var(--muted))';
  const mutedFg = 'hsl(var(--muted-foreground))';
  const border = 'hsl(var(--border))';
  const primary = 'hsl(var(--primary))';
  const gutterBg = 'hsl(var(--muted))';
  // Markdown syntax palette - fixed per resolved theme. We deliberately do not
  // derive every token from the user's `--primary`: a dim user accent (brown,
  // gold) becomes unreadable on either surface. The user's accent still drives
  // the editor chrome (cursor, selection, search match) above.
  const syntax = isDark
    ? {
        heading: '#ff7b72', // red-salmon
        link: '#58a6ff',    // blue
        url: '#a5d6ff',     // light blue
        code: '#a5d6ff',
        marker: '#ff7b72',  // `#`, `*`, `>`, list bullets
        keyword: '#ff7b72',
        literal: '#79c0ff',
        tag: '#7ee787',     // tag / class names
      }
    : {
        heading: '#cf222e',
        link: '#0969da',
        url: '#0a3069',
        code: '#0a3069',
        marker: '#cf222e',
        keyword: '#cf222e',
        literal: '#0550ae',
        tag: '#116329',
      };
  const selection = isDark
    ? 'hsl(var(--primary) / 0.30)'
    : 'hsl(var(--primary) / 0.20)';
  const activeLine = isDark
    ? 'hsl(var(--muted) / 0.50)'
    : 'hsl(var(--muted) / 0.60)';

  const theme = EditorView.theme(
    {
      '&': {
        height: '100%',
        fontSize: `${fontSize}px`,
        color: fg,
        backgroundColor: bg,
      },
      '.cm-scroller': {
        overflow: 'auto',
        lineHeight: `${lineHeight}`,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      },
      '.cm-content': {
        padding: isMobile ? '16px' : '24px 32px',
        caretColor: primary,
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: primary,
        borderLeftWidth: '2px',
      },
      '&.cm-focused .cm-cursor': {
        borderLeftColor: primary,
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: selection,
      },
      '.cm-activeLine': {
        backgroundColor: activeLine,
      },
      '.cm-activeLineGutter': {
        backgroundColor: activeLine,
        color: fg,
      },
      '.cm-gutters': {
        backgroundColor: gutterBg,
        color: mutedFg,
        border: 'none',
        borderRight: `1px solid ${border}`,
        ...(showLineNumbers ? {} : { display: 'none' }),
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 8px 0 12px',
        minWidth: '24px',
      },
      '.cm-foldGutter .cm-gutterElement': {
        color: mutedFg,
      },
      '.cm-scroller::-webkit-scrollbar': {
        width: '10px',
        height: '10px',
      },
      '.cm-scroller::-webkit-scrollbar-track': {
        background: bg,
      },
      '.cm-scroller::-webkit-scrollbar-thumb': {
        background: muted,
        borderRadius: '6px',
      },
      '.cm-scroller::-webkit-scrollbar-thumb:hover': {
        background: border,
      },
      '.cm-panels': {
        backgroundColor: bg,
        color: fg,
      },
      '.cm-panels.cm-panels-top': {
        borderBottom: `1px solid ${border}`,
      },
      '.cm-panels.cm-panels-bottom': {
        borderTop: `1px solid ${border}`,
      },
      '.cm-searchMatch': {
        backgroundColor: 'hsl(var(--primary) / 0.20)',
        outline: `1px solid ${primary}`,
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'hsl(var(--primary) / 0.40)',
      },
      '.cm-matchingBracket, .cm-nonmatchingBracket': {
        backgroundColor: 'hsl(var(--primary) / 0.18)',
        color: fg,
        outline: `1px solid ${border}`,
      },
      '.cm-tooltip': {
        backgroundColor: bg,
        color: fg,
        border: `1px solid ${border}`,
        borderRadius: '6px',
      },
      '.cm-tooltip-autocomplete': {
        '& > ul > li[aria-selected]': {
          backgroundColor: muted,
          color: fg,
        },
      },
      '.cm-selectionMatch': {
        backgroundColor: 'hsl(var(--primary) / 0.15)',
      },
      // Markdown fenced code block background - reuse muted surface.
      '.cm-line:has(.tok-monospace), .cm-line.cm-codeblock': {
        backgroundColor: 'hsl(var(--muted) / 0.40)',
      },
    },
    { dark: isDark },
  );

  // High-contrast markdown highlighter built from theme tokens. Every spec
  // sets an explicit color so CodeMirror writes inline `style=` attributes
  // that survive on top of any default fallback style.
  const highlightStyle = HighlightStyle.define([
    { tag: t.heading1, color: syntax.heading, fontWeight: '700' },
    { tag: t.heading2, color: syntax.heading, fontWeight: '700' },
    { tag: t.heading3, color: syntax.heading, fontWeight: '700' },
    { tag: t.heading4, color: syntax.heading, fontWeight: '700' },
    { tag: t.heading5, color: syntax.heading, fontWeight: '700' },
    { tag: t.heading6, color: syntax.heading, fontWeight: '700' },
    { tag: t.heading, color: syntax.heading, fontWeight: '700' },
    { tag: t.strong, color: fg, fontWeight: '700' },
    { tag: t.emphasis, color: fg, fontStyle: 'italic' },
    { tag: t.strikethrough, color: mutedFg, textDecoration: 'line-through' },
    { tag: t.link, color: syntax.link, textDecoration: 'underline' },
    { tag: t.url, color: syntax.url, textDecoration: 'underline' },
    { tag: [t.monospace, t.string, t.special(t.string)], color: syntax.code },
    { tag: [t.comment, t.lineComment, t.blockComment], color: mutedFg, fontStyle: 'italic' },
    { tag: [t.meta, t.processingInstruction], color: syntax.marker, fontWeight: '600' },
    { tag: [t.list, t.quote], color: syntax.marker },
    { tag: [t.bracket, t.punctuation, t.separator], color: fg },
    { tag: [t.keyword, t.operator, t.atom], color: syntax.keyword },
    { tag: [t.number, t.bool, t.literal], color: syntax.literal },
    { tag: [t.tagName, t.attributeName, t.typeName, t.className], color: syntax.tag },
    { tag: [t.variableName, t.propertyName, t.name], color: fg },
    { tag: t.invalid, color: 'hsl(var(--destructive, 0 84% 60%))' },
  ]);

  // No `fallback: true` here - we must override basicSetup's default style
  // which paints markdown markers in `#404740` (designed for light surfaces).
  return [theme, syntaxHighlighting(highlightStyle)];
}
