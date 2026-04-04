/**
 * MessageCompose - Rich compose box for sending chat messages.
 *
 * Uses a contentEditable div to support inline MentionChip rendering
 * alongside plain text. Mentions are inserted as non-editable chip
 * elements with a data-urn attribute, and serialized back to
 * [[[label|urn]]] syntax on send.
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import {
  Plus,
  Smiley,
  At,
  Code,
  TextB,
  PaperPlaneRight,
  ArrowBendUpLeft,
  X,
} from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { ChatMentionPopup } from '@/features/agents/components/chat/ChatMentionPopup';
import { getUrnTypeTheme } from '@/config/theme/urnColors';
import { parseUrn } from '@/shared/utils/urn';
import { EmojiPicker } from '@/features/chat/components/compose/EmojiPicker';
import type { SearchResultItem } from '@uniffy/proto/search/v1/search_pb';

interface MessageComposeProps {
  channelName: string;
  placeholder?: string;
  onSend?: (content: string) => void;
  onTyping?: () => void;
  replyTo?: {
    id: string;
    senderName: string;
    contentPreview: string;
  } | null;
  onCancelReply?: () => void;
}

const MAX_HEIGHT = 200;
const CHAR_WARN_THRESHOLD = 28_000;
const MENTION_ATTR = 'data-mention-urn';
const MENTION_LABEL_ATTR = 'data-mention-label';

/**
 * Serialize the contentEditable innerHTML back to markdown with [[[label|urn]]] mentions.
 */
function serializeToMarkdown(container: HTMLDivElement): string {
  let result = '';

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent ?? '';
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;

      // Mention chip element
      const urn = el.getAttribute(MENTION_ATTR);
      if (urn) {
        const label = el.getAttribute(MENTION_LABEL_ATTR) ?? el.textContent ?? '';
        result += `[[[${label}|${urn}]]]`;
        return;
      }

      // Line breaks
      if (el.tagName === 'BR') {
        result += '\n';
        return;
      }

      // Block elements add newlines
      if (el.tagName === 'DIV' || el.tagName === 'P') {
        if (result.length > 0 && !result.endsWith('\n')) {
          result += '\n';
        }
        for (const child of el.childNodes) {
          walk(child);
        }
        return;
      }

      // Walk children for other elements
      for (const child of el.childNodes) {
        walk(child);
      }
    }
  }

  for (const child of container.childNodes) {
    walk(child);
  }

  return result;
}

/**
 * Create a mention chip DOM element to insert into contentEditable.
 */
function createMentionElement(label: string, urn: string): HTMLSpanElement {
  const parsed = parseUrn(urn);
  const theme = getUrnTypeTheme(parsed.type);

  const chip = document.createElement('span');
  chip.setAttribute(MENTION_ATTR, urn);
  chip.setAttribute(MENTION_LABEL_ATTR, label);
  chip.contentEditable = 'false';
  chip.className = [
    'inline-flex items-center align-middle gap-1.5',
    'px-2 py-1 mx-0.5 my-0.5',
    'rounded-lg border cursor-default select-none',
    'text-sm font-medium text-foreground',
    theme.border,
    theme.badgeBg,
  ].join(' ');

  // Icon
  const iconWrapper = document.createElement('span');
  iconWrapper.className = `flex items-center justify-center shrink-0 w-5 h-5 rounded-md ${theme.iconBg}`;
  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  iconSvg.setAttribute('width', '12');
  iconSvg.setAttribute('height', '12');
  iconSvg.setAttribute('viewBox', '0 0 256 256');
  iconSvg.setAttribute('fill', 'white');
  iconSvg.setAttribute('class', 'text-white');
  iconWrapper.appendChild(iconSvg);
  chip.appendChild(iconWrapper);

  // Label text
  const labelSpan = document.createElement('span');
  labelSpan.className = 'truncate max-w-[180px]';
  labelSpan.textContent = label;
  chip.appendChild(labelSpan);

  return chip;
}

export function MessageCompose({ channelName, placeholder, onSend, onTyping, replyTo, onCancelReply }: MessageComposeProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [charCount, setCharCount] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const mentionStartNodeRef = useRef<Node | null>(null);
  const mentionStartOffsetRef = useRef(0);

  // Auto-focus editor when replying to a message
  useEffect(() => {
    if (replyTo) {
      editorRef.current?.focus();
    }
  }, [replyTo]);

  const displayPlaceholder = placeholder ?? `Type a message to ${channelName}...`;

  const updateState = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const text = el.textContent ?? '';
    setIsEmpty(text.trim().length === 0 && el.querySelectorAll(`[${MENTION_ATTR}]`).length === 0);
    setCharCount(text.length);
  }, []);

  // Handle input changes
  const handleInput = useCallback(() => {
    updateState();
    onTyping?.();

    if (mentionActive) return;

    // Detect @ trigger
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;

    const text = node.textContent ?? '';
    const offset = range.startOffset;
    const textBefore = text.slice(0, offset);

    const atIndex = textBefore.lastIndexOf('@');
    if (atIndex === -1) return;

    // @ must be at start or preceded by whitespace
    if (atIndex > 0 && textBefore[atIndex - 1] !== ' ' && textBefore[atIndex - 1] !== '\n') return;

    const query = textBefore.slice(atIndex + 1);
    if (query.includes('\n') || query.includes(' ')) return;

    mentionStartNodeRef.current = node;
    mentionStartOffsetRef.current = atIndex;
    setMentionQuery(query);
    setMentionActive(true);
  }, [updateState, mentionActive, onTyping]);

  // Handle mention selection from popup
  const handleMentionSelect = useCallback((result: SearchResultItem) => {
    const el = editorRef.current;
    if (!el) return;

    const startNode = mentionStartNodeRef.current;
    if (!startNode || !startNode.parentNode) {
      setMentionActive(false);
      return;
    }

    const text = startNode.textContent ?? '';
    const atOffset = mentionStartOffsetRef.current;

    // Find current cursor position to determine how much text to replace
    const sel = window.getSelection();
    let endOffset = text.length;
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (range.startContainer === startNode) {
        endOffset = range.startOffset;
      }
    }

    // Create the mention chip
    const chip = createMentionElement(result.title, result.urn);

    // Split the text node: [before @] [chip] [after cursor]
    const before = text.slice(0, atOffset);
    const after = text.slice(endOffset);

    const parent = startNode.parentNode;
    const beforeNode = document.createTextNode(before);
    const afterNode = document.createTextNode(after.length > 0 ? after : '\u00A0'); // nbsp to keep cursor position

    parent.insertBefore(beforeNode, startNode);
    parent.insertBefore(chip, startNode);
    parent.insertBefore(afterNode, startNode);
    parent.removeChild(startNode);

    // Place cursor after the chip
    const newRange = document.createRange();
    newRange.setStart(afterNode, after.length > 0 ? 0 : 1);
    newRange.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(newRange);

    setMentionActive(false);
    setMentionQuery('');
    mentionStartNodeRef.current = null;
    updateState();
    el.focus();
  }, [updateState]);

  const handleMentionClose = useCallback(() => {
    setMentionActive(false);
    setMentionQuery('');
    mentionStartNodeRef.current = null;
    editorRef.current?.focus();
  }, []);

  // Handle send
  const handleSend = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;

    const markdown = serializeToMarkdown(el);
    const trimmed = markdown.trim();
    if (!trimmed) return;

    onSend?.(trimmed);
    el.innerHTML = '';
    updateState();
  }, [onSend, updateState]);

  // Handle keydown
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Block Enter while mention popup is open
    if (mentionActive && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      return;
    }

    // Escape closes mention popup, or clears reply preview
    if (e.key === 'Escape') {
      if (mentionActive) {
        handleMentionClose();
        return;
      }
      if (replyTo) {
        onCancelReply?.();
        return;
      }
    }

    // Enter sends, Shift+Enter inserts newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    // Markdown shortcuts
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;

      const range = sel.getRangeAt(0);
      const selected = range.toString();

      let wrapped: string | null = null;

      if (e.key === 'b') {
        e.preventDefault();
        wrapped = `**${selected}**`;
      } else if (e.key === 'i') {
        e.preventDefault();
        wrapped = `*${selected}*`;
      }

      if (wrapped !== null && selected.length > 0) {
        range.deleteContents();
        range.insertNode(document.createTextNode(wrapped));
        range.collapse(false);
        updateState();
      }
    }
  }, [mentionActive, handleSend, handleMentionClose, updateState, replyTo, onCancelReply]);

  // Trigger mention from toolbar @ button
  const handleAtButtonClick = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;

    el.focus();

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);

    // Insert @ at cursor
    const atText = document.createTextNode('@');
    range.deleteContents();
    range.insertNode(atText);

    // Move cursor after @
    range.setStartAfter(atText);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);

    // Trigger mention detection
    mentionStartNodeRef.current = atText;
    mentionStartOffsetRef.current = 0;
    setMentionQuery('');
    setMentionActive(true);
  }, []);

  // Insert emoji at cursor position
  const handleEmojiSelect = useCallback((emoji: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode(emoji);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      el.textContent += emoji;
    }

    updateState();
    setShowEmojiPicker(false);
  }, [updateState]);

  // Insert a fenced code block at cursor
  const handleCodeBlockInsert = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const codeBlock = document.createTextNode('```\n\n```');
      range.deleteContents();
      range.insertNode(codeBlock);
      // Position cursor inside the code block
      range.setStart(codeBlock, 4); // after the opening ``` and newline
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    updateState();
  }, [updateState]);

  // Insert bold markers at cursor or wrap selection
  const handleBoldInsert = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    const selected = range.toString();

    if (selected.length > 0) {
      const wrapped = `**${selected}**`;
      range.deleteContents();
      const textNode = document.createTextNode(wrapped);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
    } else {
      const marker = document.createTextNode('**text**');
      range.deleteContents();
      range.insertNode(marker);
      // Select the word "text" so user can type over it
      range.setStart(marker, 2);
      range.setEnd(marker, 6);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    updateState();
  }, [updateState]);

  // Auto-resize
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      if (el.scrollHeight > MAX_HEIGHT) {
        el.style.maxHeight = `${MAX_HEIGHT}px`;
        el.style.overflowY = 'auto';
      } else {
        el.style.maxHeight = '';
        el.style.overflowY = '';
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const toolbarButtonClass =
    'p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors';

  return (
    <>
      <div className="mx-4 mb-4 border border-border rounded-xl bg-muted/30 focus-within:ring-1 focus-within:ring-ring focus-within:border-transparent transition-all">
        {/* Reply preview banner */}
        {replyTo && (
          <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border/50 bg-muted/40 rounded-t-xl">
            <div className="flex items-center gap-2 min-w-0 text-xs">
              <ArrowBendUpLeft size={14} className="shrink-0 text-primary" />
              <span className="text-muted-foreground shrink-0">Replying to</span>
              <span className="font-semibold text-foreground truncate">{replyTo.senderName}</span>
              <span className="text-muted-foreground/60 truncate hidden sm:inline">{replyTo.contentPreview}</span>
            </div>
            <button
              type="button"
              className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              onClick={onCancelReply}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Character count warning */}
        {charCount >= CHAR_WARN_THRESHOLD && (
          <div className="flex justify-end px-4 pt-1">
            <span className="text-xs text-muted-foreground">
              {charCount.toLocaleString()} characters
            </span>
          </div>
        )}

        {/* Editable area */}
        <div className="relative">
          {/* Placeholder */}
          {isEmpty && (
            <div className="absolute px-4 pt-3 pb-2 text-sm text-muted-foreground pointer-events-none select-none">
              {displayPlaceholder}
            </div>
          )}

          <div
            ref={editorRef}
            contentEditable
            role="textbox"
            aria-label={displayPlaceholder}
            aria-multiline="true"
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            className="w-full px-4 pt-3 pb-2 text-sm min-h-[40px] outline-none text-foreground break-words whitespace-pre-wrap"
            suppressContentEditableWarning
          />
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-2 py-1.5 border-t border-border/50">
          {/* Left actions */}
          <div className="flex items-center gap-0.5">
            <button type="button" className={toolbarButtonClass} aria-label="Attach file">
              <Plus size={18} />
            </button>
            <button
              ref={emojiButtonRef}
              type="button"
              className={toolbarButtonClass}
              aria-label="Add emoji"
              onClick={() => setShowEmojiPicker((prev) => !prev)}
            >
              <Smiley size={18} />
            </button>
            {showEmojiPicker && (
              <EmojiPicker
                anchorRef={emojiButtonRef}
                onSelect={handleEmojiSelect}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}
            <button
              type="button"
              className={toolbarButtonClass}
              aria-label="Mention someone"
              onClick={handleAtButtonClick}
            >
              <At size={18} />
            </button>
            <button
              type="button"
              className={toolbarButtonClass}
              aria-label="Insert code block"
              onClick={handleCodeBlockInsert}
            >
              <Code size={18} />
            </button>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className={toolbarButtonClass}
              aria-label="Toggle formatting"
              onClick={handleBoldInsert}
            >
              <TextB size={18} />
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={isEmpty}
              aria-label="Send message"
              className={cn(
                'p-1.5 rounded-md transition-colors',
                !isEmpty
                  ? 'text-primary hover:bg-primary/10 cursor-pointer'
                  : 'text-muted-foreground/50 cursor-not-allowed',
              )}
            >
              <PaperPlaneRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Mention search popup */}
      {mentionActive && (
        <ChatMentionPopup
          initialQuery={mentionQuery}
          onSelect={handleMentionSelect}
          onClose={handleMentionClose}
        />
      )}
    </>
  );
}
