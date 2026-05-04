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
  Pencil,
  X,
} from '@phosphor-icons/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cn } from '@/shared/utils/cn';
import { ChatMentionPopup } from '@/features/agents/components/chat/ChatMentionPopup';
import { parseUrn, UrnType } from '@/shared/utils/urn';
import { getContentTypeConfig } from '@/config/theme/contentTypes';
import { getInitials } from '@/components/subject/utils';
import { useKeybinding, matchesShortcut } from '@/features/settings';
import { EmojiPicker } from '@/features/chat/components/compose/EmojiPicker';
import { AttachmentPreviewBar } from '@/features/chat/components/compose/AttachmentPreviewBar';
import { filesApi } from '@/features/files/api/filesApi';
import { attachmentsApi } from '@/features/attachments';
import { randomUUID } from '@/shared/utils/uuid';
import type { SearchResultItem } from '@uniffy/proto/search/v1/search_pb';

interface PendingFile {
  id: string;
  name: string;
  size: number;
  progress: number;
  fileId?: string;
  aborted?: boolean;
}

interface MessageComposeProps {
  channelName: string;
  placeholder?: string;
  organizationId?: string;
  onSend?: (content: string, fileIds: string[]) => void;
  onTyping?: () => void;
  replyTo?: {
    id: string;
    senderName: string;
    contentPreview: string;
  } | null;
  onCancelReply?: () => void;
  editingMessage?: {
    id: string;
    channelId: string;
    content: string;
  } | null;
  onSaveEdit?: (content: string) => void;
  onCancelEdit?: () => void;
  /** Fired when the bound `chat.editLast` key is pressed in an empty compose. */
  onEditLast?: () => void;
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
 * Static chip used inside the compose contentEditable. Mirrors the visual
 * language of `MentionChipBasic` but never renders an `<img>` for user
 * avatars — under `renderToStaticMarkup` the onError fallback in
 * `MentionChipBasic` cannot run, leaving broken-image glyphs when the
 * subject has no avatar. Initials/type icons are deterministic from props.
 */
function ComposeMentionChipStatic({ urn, label }: { urn: string; label: string }) {
  const parsed = parseUrn(urn);
  const config = getContentTypeConfig(parsed.type);
  const TypeIcon = config.icon;
  const theme = config.theme;
  const isUser = parsed.type === UrnType.USER && !!parsed.id;

  return (
    <span
      className={cn(
        'mention-chip inline-flex items-center align-middle',
        'gap-1.5 px-2 py-1 mx-0.5 my-0.5',
        'rounded-md border',
        'bg-gradient-to-r', theme.gradient,
        theme.border,
        'cursor-default select-none',
      )}
    >
      {isUser ? (
        <span
          className={cn(
            'grid place-items-center shrink-0 w-5 h-5 rounded-full text-[8px] font-semibold',
            theme.iconBoxAccent,
          )}
        >
          {getInitials(label)}
        </span>
      ) : (
        <span
          className={cn(
            'grid place-items-center shrink-0 w-5 h-5 rounded',
            theme.iconBoxAccent,
          )}
        >
          <TypeIcon size={11} weight="duotone" />
        </span>
      )}
      <span className="text-sm font-medium text-foreground truncate max-w-[200px] leading-tight">
        {label}
      </span>
    </span>
  );
}

/**
 * Create a mention chip DOM element to insert into contentEditable.
 * Outer wrapper carries the data attributes used by `serializeToMarkdown`
 * to recover `[[[label|urn]]]`; inner content is static HTML.
 */
function createMentionElement(label: string, urn: string): HTMLSpanElement {
  const wrapper = document.createElement('span');
  wrapper.setAttribute(MENTION_ATTR, urn);
  wrapper.setAttribute(MENTION_LABEL_ATTR, label);
  wrapper.contentEditable = 'false';
  wrapper.className = 'inline-block align-middle';
  wrapper.innerHTML = renderToStaticMarkup(
    <ComposeMentionChipStatic urn={urn} label={label} />,
  );
  return wrapper;
}

export function MessageCompose({ channelName, placeholder, organizationId, onSend, onTyping, replyTo, onCancelReply, editingMessage, onSaveEdit, onCancelEdit, onEditLast }: MessageComposeProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [charCount, setCharCount] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const mentionStartNodeRef = useRef<Node | null>(null);
  const mentionStartOffsetRef = useRef(0);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const editLastBinding = useKeybinding('chat.editLast');

  const uploadFile = useCallback(async (file: File, pendingId: string) => {
    if (!organizationId) return;

    try {
      const folderRes = await attachmentsApi.getAttachmentsFolder({ organizationId });
      const folderId = folderRes.folderId;

      const initRes = await filesApi.initiateUpload({
        organizationId,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        totalSize: BigInt(file.size),
        folderId,
      });

      const { uploadId, chunkSize, totalChunks } = initRes;
      const fileBuffer = await file.arrayBuffer();

      for (let chunkNumber = 1; chunkNumber <= totalChunks; chunkNumber++) {
        const start = (chunkNumber - 1) * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunkData = new Uint8Array(fileBuffer.slice(start, end));

        await filesApi.uploadChunk({
          uploadId,
          chunkNumber,
          data: chunkData,
          isLast: chunkNumber === totalChunks,
        });

        const progress = Math.round((chunkNumber / totalChunks) * 90);
        setPendingFiles((prev) =>
          prev.map((pf) => (pf.id === pendingId ? { ...pf, progress } : pf)),
        );
      }

      const completeRes = await filesApi.completeUpload({ uploadId });
      const fileId = completeRes.file?.id;
      if (!fileId) throw new Error('Upload completed but no file ID returned');

      setPendingFiles((prev) =>
        prev.map((pf) => (pf.id === pendingId ? { ...pf, fileId, progress: 100 } : pf)),
      );
    } catch (err) {
      console.error('[MessageCompose] Upload failed:', err);
      setPendingFiles((prev) => prev.filter((pf) => pf.id !== pendingId));
    }
  }, [organizationId]);

  const handleFilesSelected = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const id = randomUUID();
      setPendingFiles((prev) => [...prev, { id, name: file.name, size: file.size, progress: 0 }]);
      uploadFile(file, id);
    }
  }, [uploadFile]);

  const handleRemovePendingFile = useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleFilesSelected(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handleFilesSelected]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFilesSelected(e.dataTransfer.files);
  }, [handleFilesSelected]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Clipboard paste: route file items (images, etc.) through the attachments
  // upload pipeline. Plain text/HTML continues through the default paste path.
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length === 0) return;

    e.preventDefault();
    const dt = new DataTransfer();
    for (const f of files) {
      // Pasted screenshots arrive as "image.png"; stamp a unique name so
      // multiple pastes in one message don't collide on the server.
      const named = f.name && f.name !== 'image.png'
        ? f
        : new File([f], `pasted-${Date.now()}.${(f.type.split('/')[1] ?? 'png')}`, { type: f.type });
      dt.items.add(named);
    }
    handleFilesSelected(dt.files);
  }, [handleFilesSelected]);

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
    const hasText = text.trim().length > 0 || el.querySelectorAll(`[${MENTION_ATTR}]`).length > 0;
    setIsEmpty(!hasText && pendingFiles.length === 0);
    setCharCount(text.length);
  }, [pendingFiles.length]);

  // Populate editor with message content when entering edit mode
  const prevEditIdRef = useRef<string | null>(null);
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (editingMessage && editingMessage.id !== prevEditIdRef.current) {
      prevEditIdRef.current = editingMessage.id;
      el.textContent = editingMessage.content;
      updateState();
      el.focus();
      // Move cursor to end
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    } else if (!editingMessage && prevEditIdRef.current) {
      prevEditIdRef.current = null;
      el.innerHTML = '';
      updateState();
    }
  }, [editingMessage, updateState]);

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

    if (editingMessage) {
      if (trimmed && trimmed !== editingMessage.content) {
        onSaveEdit?.(trimmed);
      } else {
        onCancelEdit?.();
      }
      el.innerHTML = '';
      updateState();
      return;
    }

    const fileIds = pendingFiles.filter((f) => f.fileId).map((f) => f.fileId!);

    if (!trimmed && fileIds.length === 0) return;

    onSend?.(trimmed, fileIds);
    el.innerHTML = '';
    setPendingFiles([]);
    updateState();
  }, [onSend, updateState, pendingFiles, editingMessage, onSaveEdit, onCancelEdit]);

  // Handle keydown
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Backspace deletes a mention chip when the caret sits immediately
    // after one. Browsers leave contentEditable=false elements partially
    // selectable, so we delete them programmatically.
    if (e.key === 'Backspace' && !e.shiftKey) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        const node = range.startContainer;
        const offset = range.startOffset;

        const findChipBefore = (): HTMLElement | null => {
          if (node.nodeType === Node.TEXT_NODE) {
            if (offset !== 0) return null;
            const prev = node.previousSibling;
            return prev && prev.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).hasAttribute(MENTION_ATTR)
              ? (prev as HTMLElement) : null;
          }
          if (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
            const prev = (node as HTMLElement).childNodes[offset - 1];
            return prev && prev.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).hasAttribute(MENTION_ATTR)
              ? (prev as HTMLElement) : null;
          }
          return null;
        };

        const chip = findChipBefore();
        if (chip) {
          e.preventDefault();
          chip.remove();
          updateState();
          return;
        }
      }
    }

    // Edit last own message (Slack-style). Only when compose is empty,
    // not already editing, no reply preview, no mention popup, and no
    // pending uploads — otherwise the keystroke belongs to the editor
    // (e.g. caret navigation).
    if (
      onEditLast
      && editLastBinding
      && isEmpty
      && !editingMessage
      && !replyTo
      && !mentionActive
      && pendingFiles.length === 0
      && matchesShortcut(e.nativeEvent, editLastBinding)
    ) {
      e.preventDefault();
      onEditLast();
      return;
    }

    // Block Enter while mention popup is open
    if (mentionActive && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      return;
    }

    // Escape closes mention popup, cancels edit, or clears reply preview
    if (e.key === 'Escape') {
      if (mentionActive) {
        handleMentionClose();
        return;
      }
      if (editingMessage) {
        onCancelEdit?.();
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
  }, [mentionActive, handleSend, handleMentionClose, updateState, replyTo, onCancelReply, editingMessage, onCancelEdit, isEmpty, pendingFiles.length, onEditLast, editLastBinding]);

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
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
      <div
        className="mx-4 mb-4 border border-border rounded-xl bg-muted focus-within:ring-1 focus-within:ring-ring focus-within:border-transparent transition-all"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        data-testid="chat-compose-root"
        data-mode={editingMessage ? 'edit' : replyTo ? 'reply' : 'normal'}
      >
        {/* Edit mode banner */}
        {editingMessage && (
          <div
            className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border/50 bg-primary/5 rounded-t-xl"
            data-testid="chat-compose-edit-banner"
          >
            <div className="flex items-center gap-2 min-w-0 text-xs">
              <Pencil size={14} className="shrink-0 text-primary" />
              <span className="text-muted-foreground shrink-0">Editing message</span>
              <span className="text-muted-foreground/60 hidden sm:inline">Escape to cancel, Enter to save</span>
            </div>
            <button
              type="button"
              className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              onClick={onCancelEdit}
              data-testid="chat-compose-edit-cancel"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Reply preview banner */}
        {replyTo && !editingMessage && (
          <div
            className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border/50 bg-muted/40 rounded-t-xl"
            data-testid="chat-compose-reply-banner"
          >
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
              data-testid="chat-compose-reply-cancel"
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
            onPaste={handlePaste}
            className="w-full px-4 pt-3 pb-2 text-sm min-h-[40px] outline-none text-foreground break-words whitespace-pre-wrap"
            suppressContentEditableWarning
            data-testid="chat-compose-input"
            data-empty={isEmpty ? 'true' : 'false'}
          />
        </div>

        {/* Pending attachments */}
        <AttachmentPreviewBar
          files={pendingFiles}
          onRemove={handleRemovePendingFile}
        />

        {/* Toolbar */}
        <div className="flex items-center justify-between px-2 py-1.5 border-t border-border/50">
          {/* Left actions */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className={toolbarButtonClass}
              aria-label="Attach file"
              onClick={handleAttachClick}
              data-testid="chat-compose-attach-button"
            >
              <Plus size={18} />
            </button>
            <button
              ref={emojiButtonRef}
              type="button"
              className={toolbarButtonClass}
              aria-label="Add emoji"
              onClick={() => setShowEmojiPicker((prev) => !prev)}
              data-testid="chat-compose-emoji-button"
              data-state={showEmojiPicker ? 'open' : 'closed'}
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
              data-testid="chat-compose-mention-button"
            >
              <At size={18} />
            </button>
            <button
              type="button"
              className={toolbarButtonClass}
              aria-label="Insert code block"
              onClick={handleCodeBlockInsert}
              data-testid="chat-compose-code-button"
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
              data-testid="chat-compose-bold-button"
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
              data-testid="chat-compose-send-button"
              data-disabled={isEmpty ? 'true' : 'false'}
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
