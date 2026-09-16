/** ContentEditable compose; mention chips serialize back to `[[[label|urn]]]` on send. */

import { useRef, useEffect, useLayoutEffect, useCallback, useMemo, useState } from "react";
import {
  Plus,
  Smiley,
  At,
  Code,
  TextB,
  PaperPlaneRight,
  ArrowBendUpLeft,
  Pencil,
  Lightning,
  X,
} from "@phosphor-icons/react";
import { renderToStaticMarkup } from "react-dom/server";
import { cn } from "@/shared/utils/cn";
import { Checkbox } from "@/components/ui/checkbox";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { ChatMentionPopup } from "@/features/agents/components/chat/ChatMentionPopup";
import { SkillSlashPopup } from "@/features/agents/components/chat/SkillSlashPopup";
import { computeSlashToken } from "@/features/agents/utils/slashCommands";
import {
  matchChatSkillCommand,
  mentionedSkillAgents,
  resolveChatSkillAgent,
} from "@/features/chat/utils/skillCommands";
import {
  fetchRunnableSkills,
  type SerializedRunnableSkill,
} from "@/features/agents/store/agentRunnableSkillsThunks";
import { selectRunnableSkillsForAgent } from "@/features/agents/store/agentRunnableSkillsSlice";
import { parseUrn } from "@/shared/utils/urn";
import { getContentTypeConfig } from "@/config/theme/contentTypes";
import { isPeopleTokenType, peopleTokenClasses } from "@/components/mention/mentionConstants";
import { sanitizeMentionLabel } from "@/shared/utils/mentionUtils";
import { useKeybinding, matchesShortcut } from "@/features/settings";
import { EmojiPicker } from "@/features/chat/components/compose/EmojiPicker";
import { AgentModelPicker } from "@/features/chat/components/compose/AgentModelPicker";
import { AgentParamsPopover } from "@/features/chat/components/compose/AgentParamsPopover";
import { useChannelAgentConfig } from "@/features/chat/hooks/useChannelAgentConfig";
import { AttachmentPreviewBar } from "@/features/chat/components/compose/AttachmentPreviewBar";
import { restoreComposeFocus } from "@/features/chat/components/compose/composeFocus";
import {
  needsTeamMentionConfirm,
  resolveTeamMentionTotal,
  teamMentionsIn,
} from "@/features/chat/utils/teamMentionGuard";
import {
  BROADCAST_URN_PREFIX,
  DEFAULT_BROADCAST_CONFIRM_THRESHOLD,
  broadcastMentionsIn,
  buildBroadcastEntries,
  effectiveBroadcastKind,
  type BroadcastKind,
} from "@/features/chat/utils/broadcastMentions";
import { useChatPermissions } from "@/features/chat/hooks/useChatPermissions";
import { selectOrgChatPolicy } from "@/features/chat/store/chatChannelsSlice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { uploadService } from "@/features/files/upload";
import { attachmentsApi } from "@/features/files/api/attachmentsApi";
import { randomUUID } from "@/shared/utils/uuid";
import type { SearchResultItem } from "@uniffy/proto/search/v1/search_pb";

interface PendingFile {
  id: string;
  name: string;
  size: number;
  progress: number;
  fileId?: string;
  aborted?: boolean;
}

interface PendingTeamSend {
  content: string;
  fileIds: string[];
  metadata?: Record<string, string>;
  total: number;
  labels: string[];
}

interface PendingBroadcastSend {
  content: string;
  fileIds: string[];
  metadata?: Record<string, string>;
  kind: BroadcastKind;
  memberCount: number;
}

interface MessageComposeProps {
  channelName: string;
  /** Enables channel-aware toolbar extras (agent DM model picker). */
  channelId?: string;
  threadRootId?: string;
  placeholder?: string;
  organizationId?: string;
  onSend?: (
    content: string,
    fileIds: string[],
    metadata?: Record<string, string>,
  ) => Promise<boolean>;
  onTyping?: () => void;
  replyTo?: {
    id: string;
    senderName: string;
    contentPreview: string;
  } | null;
  onCancelReply?: () => void;
  /** Opt-in toggle rendered beside the send button; the thread composer uses it
   *  to also post the reply to its channel. */
  sendOption?: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  };
  editingMessage?: {
    id: string;
    channelId: string;
    content: string;
  } | null;
  onSaveEdit?: (content: string) => void;
  onCancelEdit?: () => void;
  /** Fired when the bound `chat.editLast` key is pressed in an empty compose. */
  onEditLast?: () => void;
  /** Canonical Markdown restored into an untouched empty composer. */
  initialDraft?: string | null;
  /** Non-null only when a remote draft change is safe to apply; replaces the editor content. */
  remoteDraft?: string | null;
  onDraftChange?: (markdown: string) => void;
  /** 'hero' floats the composer as a glass card in the agent DM empty state. */
  variant?: "bar" | "hero";
}

const MAX_HEIGHT = 200;
const CHAR_WARN_THRESHOLD = 28_000;
const MENTION_ATTR = "data-mention-urn";
const MENTION_LABEL_ATTR = "data-mention-label";

function serializeToMarkdown(container: HTMLDivElement): string {
  let result = "";

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent ?? "";
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;

      const urn = el.getAttribute(MENTION_ATTR);
      if (urn) {
        const label = el.getAttribute(MENTION_LABEL_ATTR) ?? el.textContent ?? "";
        result += `[[[${sanitizeMentionLabel(label)}|${urn}]]]`;
        return;
      }

      if (el.tagName === "BR") {
        result += "\n";
        return;
      }

      if (el.tagName === "DIV" || el.tagName === "P") {
        if (result.length > 0 && !result.endsWith("\n")) {
          result += "\n";
        }
        for (const child of el.childNodes) {
          walk(child);
        }
        return;
      }

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

/** Static chip for the compose contentEditable; avoids `<img>` since onError can't run under renderToStaticMarkup. */
function ComposeMentionChipStatic({ urn, label }: { urn: string; label: string }) {
  const parsed = parseUrn(urn);

  if (urn.startsWith(BROADCAST_URN_PREFIX)) {
    return <span className={peopleTokenClasses(false, false)}>@{label.replace(/^@+/, "")}</span>;
  }

  // Same Slack-style token the sent message renders; static markup has no
  // viewer context, so the self-mention wash never applies here.
  if (isPeopleTokenType(parsed.type)) {
    return <span className={peopleTokenClasses(false, false)}>@{label}</span>;
  }

  const config = getContentTypeConfig(parsed.type);
  const TypeIcon = config.icon;
  const theme = config.theme;

  return (
    <span
      className={cn(
        "mention-chip inline-flex items-center align-middle",
        "gap-1.5 px-2 py-1 mx-0.5 my-0.5",
        "rounded-md border",
        theme.badgeBg,
        theme.border,
        "cursor-default select-none",
      )}
    >
      <span className={cn("grid place-items-center shrink-0 w-5 h-5 rounded", theme.iconBoxAccent)}>
        <TypeIcon size={11} weight="duotone" />
      </span>
      <span className="text-sm font-medium text-foreground truncate max-w-[200px] leading-tight">
        {label}
      </span>
    </span>
  );
}

function createMentionElement(label: string, urn: string): HTMLSpanElement {
  const wrapper = document.createElement("span");
  wrapper.setAttribute(MENTION_ATTR, urn);
  wrapper.setAttribute(MENTION_LABEL_ATTR, label);
  wrapper.contentEditable = "false";
  // Tokens flow with the text baseline; boxed chips keep the inline-block wrapper.
  wrapper.className =
    isPeopleTokenType(parseUrn(urn).type) || urn.startsWith(BROADCAST_URN_PREFIX)
      ? "inline align-baseline"
      : "inline-block align-middle";
  wrapper.innerHTML = renderToStaticMarkup(<ComposeMentionChipStatic urn={urn} label={label} />);
  return wrapper;
}

const MENTION_MARKDOWN_PATTERN = /\[\[\[([^[\]|]+)\|([^\]]+)\]\]\]/g;

// Builds the DOM from text nodes + createMentionElement only; draft content is
// synced from other sessions and must never be assigned as an HTML string.
function hydrateFromMarkdown(container: HTMLDivElement, markdown: string): void {
  container.innerHTML = "";
  const parts = markdown.split(MENTION_MARKDOWN_PATTERN);
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i]) {
      container.appendChild(document.createTextNode(parts[i]));
    }
    const label = parts[i + 1];
    const urn = parts[i + 2];
    if (label !== undefined && urn !== undefined) {
      container.appendChild(createMentionElement(label, urn));
    }
  }
}

export function MessageCompose({
  channelName,
  channelId,
  threadRootId,
  placeholder,
  organizationId,
  onSend,
  sendOption,
  onTyping,
  replyTo,
  onCancelReply,
  editingMessage,
  onSaveEdit,
  onCancelEdit,
  onEditLast,
  initialDraft,
  remoteDraft,
  onDraftChange,
  variant = "bar",
}: MessageComposeProps) {
  const dispatch = useAppDispatch();
  const channel = useAppSelector((state) =>
    channelId ? state.chatChannels.byId[channelId] : undefined,
  );
  const agentDmAgentId = channel?.isAgentDm ? channel.agentId : undefined;
  const replyMessage = useAppSelector((state) => {
    if (!replyTo) return undefined;
    return (
      state.chatMessages.byId[replyTo.id] ??
      (threadRootId
        ? state.chatThreads.threadMessages[threadRootId]?.find(
            (message) => message.id === replyTo.id,
          )
        : undefined)
    );
  });
  const threadRoot = useAppSelector((state) =>
    threadRootId ? state.chatMessages.byId[threadRootId] : undefined,
  );
  const [mentionedAgentIds, setMentionedAgentIds] = useState<string[]>([]);
  const skillAgentId = useMemo(
    () =>
      resolveChatSkillAgent(
        mentionedAgentIds,
        agentDmAgentId,
        replyMessage?.senderType === "AGENT" ? replyMessage.senderId : undefined,
        threadRoot?.senderType === "AGENT" ? threadRoot.senderId : undefined,
      ),
    [mentionedAgentIds, agentDmAgentId, replyMessage, threadRoot],
  );
  const agentDmAgent = useAppSelector((state) =>
    agentDmAgentId ? (state.agents.agents[agentDmAgentId] ?? null) : null,
  );
  // One shared config so a model switch in the picker immediately drives the
  // params popover's schema; the hook no-ops for non-agent channels.
  const agentConfig = useChannelAgentConfig(channelId, agentDmAgentId);
  const editorRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLDivElement>(null);
  const focusAfterSendRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [charCount, setCharCount] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const mentionStartNodeRef = useRef<Node | null>(null);
  const mentionStartOffsetRef = useRef(0);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [pendingTeamSend, setPendingTeamSend] = useState<PendingTeamSend | null>(null);
  const [pendingBroadcastSend, setPendingBroadcastSend] = useState<PendingBroadcastSend | null>(
    null,
  );
  const { canManageChat } = useChatPermissions();
  const currentUserId = useAppSelector((s) => s.auth.user?.id);
  const channelMembers = useAppSelector((s) =>
    channelId ? s.chatChannels.channelMembers[channelId] : undefined,
  );
  const orgPolicy = useAppSelector(selectOrgChatPolicy);

  // The server enforces the same gate on send and edit; hiding the typeahead
  // entries is UX, not the boundary.
  const canBroadcast = useMemo(() => {
    if (!channelId) return false;
    if (!orgPolicy || orgPolicy.broadcastMinRole === "member") return true;
    if (canManageChat) return true;
    // The channel payload carries the viewer's role, so this works before the
    // members roster is ever fetched; the roster row is the fallback.
    if (channel?.currentUserRole === "ADMIN" || channel?.currentUserRole === "OWNER") return true;
    const mine = channelMembers?.find(
      (m) => m.subjectType === "USER" && m.userId === currentUserId,
    );
    return mine?.role === "ADMIN" || mine?.role === "OWNER";
  }, [
    channelId,
    orgPolicy,
    canManageChat,
    channel?.currentUserRole,
    channelMembers,
    currentUserId,
  ]);

  const broadcastEntries = useMemo(
    () =>
      canBroadcast && channel && channel.channelType !== "DIRECT" && !channel.isAgentDm
        ? buildBroadcastEntries()
        : [],
    [canBroadcast, channel],
  );
  const editLastBinding = useKeybinding("chat.editLast");
  // Track slash tokens against the caret's text node, like mentions.
  const [slashActive, setSlashActive] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const slashStartNodeRef = useRef<Node | null>(null);
  const slashStartOffsetRef = useRef(0);
  const slashEndOffsetRef = useRef(0);
  const [pendingInvokedSkill, setPendingInvokedSkill] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const runnableSkills = useAppSelector(selectRunnableSkillsForAgent(skillAgentId, "chat"));
  const [isSending, setIsSending] = useState(false);
  const sendingRef = useRef(false);

  useLayoutEffect(() => {
    if (isSending || !focusAfterSendRef.current) return;
    focusAfterSendRef.current = false;
    restoreComposeFocus(composeRef.current, editorRef.current);
  });

  useEffect(() => {
    if (skillAgentId && organizationId) {
      dispatch(fetchRunnableSkills({ organizationId, agentId: skillAgentId, surface: "chat" }));
    }
  }, [skillAgentId, organizationId, dispatch]);

  const uploadFile = useCallback(
    async (file: File, pendingId: string) => {
      if (!organizationId) return;

      try {
        const folderRes = await attachmentsApi.getAttachmentsFolder({ organizationId });

        // The shared engine does the slicing/POSTing in a worker (off the main thread) and keeps running
        // across navigation. Chat consumes it directly - no Redux, and persist:false since the composer
        // is ephemeral (no point auto-resuming an attachment whose message was never sent).
        const [handle] = uploadService.enqueue([
          {
            file,
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            organizationId,
            context: "chat",
            folderId: folderRes.folderId,
            persist: false,
          },
        ]);

        const unsubscribe = uploadService.subscribe((records) => {
          const record = records.find((r) => r.id === handle.id);
          if (!record) return;
          setPendingFiles((prev) =>
            prev.map((pf) => (pf.id === pendingId ? { ...pf, progress: record.progress } : pf)),
          );
        });

        try {
          const { fileId } = await handle.done;
          setPendingFiles((prev) =>
            prev.map((pf) => (pf.id === pendingId ? { ...pf, fileId, progress: 100 } : pf)),
          );
        } finally {
          unsubscribe();
        }
      } catch (err) {
        console.error("[MessageCompose] Upload failed:", err);
        setPendingFiles((prev) => prev.filter((pf) => pf.id !== pendingId));
      }
    },
    [organizationId],
  );

  const handleFilesSelected = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;

      for (const file of Array.from(files)) {
        const id = randomUUID();
        setPendingFiles((prev) => [...prev, { id, name: file.name, size: file.size, progress: 0 }]);
        uploadFile(file, id);
      }
    },
    [uploadFile],
  );

  const handleRemovePendingFile = useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFilesSelected(e.target.files);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleFilesSelected],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      handleFilesSelected(e.dataTransfer.files);
    },
    [handleFilesSelected],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Route clipboard file items through the upload pipeline; plain text/HTML uses the default path.
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;

      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }

      if (files.length === 0) return;

      e.preventDefault();
      const dt = new DataTransfer();
      for (const f of files) {
        // Stamp unique names; multiple pasted screenshots all arrive as "image.png".
        const named =
          f.name && f.name !== "image.png"
            ? f
            : new File([f], `pasted-${Date.now()}.${f.type.split("/")[1] ?? "png"}`, {
                type: f.type,
              });
        dt.items.add(named);
      }
      handleFilesSelected(dt.files);
    },
    [handleFilesSelected],
  );

  useEffect(() => {
    if (replyTo) {
      editorRef.current?.focus();
    }
  }, [replyTo]);

  const displayPlaceholder = placeholder ?? `Type a message to ${channelName}...`;

  const updateState = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const text = el.textContent ?? "";
    const hasText = text.trim().length > 0 || el.querySelectorAll(`[${MENTION_ATTR}]`).length > 0;
    setIsEmpty(!hasText && pendingFiles.length === 0);
    setCharCount(text.length);
    const agentIds = mentionedSkillAgents(serializeToMarkdown(el));
    setMentionedAgentIds((previous) => (previous.join() === agentIds.join() ? previous : agentIds));
  }, [pendingFiles.length]);

  // Edit mode is not a draft: autosave stays silent while editingMessage is set.
  const userEditedRef = useRef(false);
  const emitDraftChange = useCallback(() => {
    const el = editorRef.current;
    if (!el || !onDraftChange || editingMessage) return;
    userEditedRef.current = true;
    onDraftChange(serializeToMarkdown(el));
  }, [onDraftChange, editingMessage]);

  const prevEditIdRef = useRef<string | null>(null);
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (editingMessage && editingMessage.id !== prevEditIdRef.current) {
      prevEditIdRef.current = editingMessage.id;
      el.textContent = editingMessage.content;
      updateState();
      el.focus();
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    } else if (!editingMessage && prevEditIdRef.current) {
      prevEditIdRef.current = null;
      el.innerHTML = "";
      // Let the draft effect below restore the unsent draft the edit replaced.
      userEditedRef.current = false;
      updateState();
    }
  }, [editingMessage, updateState]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el || editingMessage || !initialDraft || userEditedRef.current) return;
    const hasContent =
      (el.textContent ?? "").trim().length > 0 ||
      el.querySelectorAll(`[${MENTION_ATTR}]`).length > 0;
    if (hasContent) return;
    hydrateFromMarkdown(el, initialDraft);
    updateState();
  }, [initialDraft, editingMessage, updateState]);

  const prevRemoteDraftRef = useRef<string | null>(null);
  useEffect(() => {
    const el = editorRef.current;
    const previous = prevRemoteDraftRef.current;
    prevRemoteDraftRef.current = remoteDraft ?? null;
    if (!el || editingMessage) return;
    if (remoteDraft == null || remoteDraft === previous) return;
    // The hook only surfaces remoteDraft when there are no unsaved local edits,
    // so replacing the editor content cannot lose typing.
    userEditedRef.current = false;
    hydrateFromMarkdown(el, remoteDraft);
    updateState();
  }, [remoteDraft, editingMessage, updateState]);

  const closeSlash = useCallback(() => {
    setSlashActive(false);
    setSlashQuery("");
    slashStartNodeRef.current = null;
  }, []);

  const handleInput = useCallback(() => {
    updateState();
    emitDraftChange();
    onTyping?.();

    if (mentionActive) return;

    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const node = range?.startContainer;
    if (!range || !node || node.nodeType !== Node.TEXT_NODE) {
      if (slashActive) closeSlash();
      return;
    }

    const text = node.textContent ?? "";
    const offset = range.startOffset;
    const textBefore = text.slice(0, offset);

    // @ must be at start or after whitespace; the query is a single token.
    const atIndex = textBefore.lastIndexOf("@");
    if (
      atIndex !== -1 &&
      (atIndex === 0 || textBefore[atIndex - 1] === " " || textBefore[atIndex - 1] === "\n")
    ) {
      const query = textBefore.slice(atIndex + 1);
      if (!query.includes("\n") && !query.includes(" ")) {
        mentionStartNodeRef.current = node;
        mentionStartOffsetRef.current = atIndex;
        setMentionQuery(query);
        setMentionActive(true);
        if (slashActive) closeSlash();
        return;
      }
    }

    if (!skillAgentId) return;

    const token = computeSlashToken(textBefore);
    if (!token) {
      if (slashActive) closeSlash();
      return;
    }
    slashStartNodeRef.current = node;
    slashStartOffsetRef.current = token.start;
    slashEndOffsetRef.current = offset;
    setSlashQuery(token.query);
    setSlashActive(true);
  }, [
    updateState,
    emitDraftChange,
    mentionActive,
    onTyping,
    skillAgentId,
    slashActive,
    closeSlash,
  ]);

  const handleMentionSelect = useCallback(
    (result: SearchResultItem) => {
      const el = editorRef.current;
      if (!el) return;

      const startNode = mentionStartNodeRef.current;
      if (!startNode || !startNode.parentNode) {
        setMentionActive(false);
        return;
      }

      const text = startNode.textContent ?? "";
      const atOffset = mentionStartOffsetRef.current;

      const sel = window.getSelection();
      let endOffset = text.length;
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (range.startContainer === startNode) {
          endOffset = range.startOffset;
        }
      }

      // Broadcast rows display as "@channel" but store the bare kind as the
      // label, matching what mobile persists for the same chip.
      const chipLabel = result.urn.startsWith(BROADCAST_URN_PREFIX)
        ? result.title.replace(/^@+/, "")
        : result.title;
      const chip = createMentionElement(chipLabel, result.urn);

      // Split text into [before @] [chip] [after cursor].
      const before = text.slice(0, atOffset);
      const after = text.slice(endOffset);

      const parent = startNode.parentNode;
      const beforeNode = document.createTextNode(before);
      const afterNode = document.createTextNode(after.length > 0 ? after : "\u00A0"); // nbsp anchors the caret

      parent.insertBefore(beforeNode, startNode);
      parent.insertBefore(chip, startNode);
      parent.insertBefore(afterNode, startNode);
      parent.removeChild(startNode);

      const newRange = document.createRange();
      newRange.setStart(afterNode, after.length > 0 ? 0 : 1);
      newRange.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(newRange);

      setMentionActive(false);
      setMentionQuery("");
      mentionStartNodeRef.current = null;
      updateState();
      emitDraftChange();
      el.focus();
    },
    [updateState, emitDraftChange],
  );

  const handleMentionClose = useCallback(() => {
    setMentionActive(false);
    setMentionQuery("");
    mentionStartNodeRef.current = null;
    editorRef.current?.focus();
  }, []);

  // Remove the typed "/query" text; the chosen skill surfaces as a chip instead.
  const handleSlashSelect = useCallback(
    (skill: SerializedRunnableSkill) => {
      const node = slashStartNodeRef.current;
      if (node) {
        const text = node.textContent ?? "";
        const start = slashStartOffsetRef.current;
        const sel = window.getSelection();
        let end = slashEndOffsetRef.current;
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          if (range.startContainer === node) {
            end = range.startOffset;
          }
        }
        node.textContent = text.slice(0, start) + text.slice(end);
        const newRange = document.createRange();
        newRange.setStart(node, Math.min(start, node.textContent.length));
        newRange.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(newRange);
      }
      setPendingInvokedSkill({ id: skill.id, name: skill.name });
      closeSlash();
      updateState();
      emitDraftChange();
      editorRef.current?.focus();
    },
    [closeSlash, updateState, emitDraftChange],
  );

  const handleSlashClose = useCallback(() => {
    closeSlash();
    editorRef.current?.focus();
  }, [closeSlash]);

  const performSend = useCallback(
    async (content: string, fileIds: string[], metadata?: Record<string, string>) => {
      if (!onSend || sendingRef.current) return;
      const el = editorRef.current;
      const html = el?.innerHTML;
      sendingRef.current = true;
      setIsSending(true);
      try {
        if (!(await onSend(content, fileIds, metadata))) return;
        if (el && editorRef.current === el && el.innerHTML === html) el.innerHTML = "";
        setPendingFiles((files) =>
          files.filter((file) => !file.fileId || !fileIds.includes(file.fileId)),
        );
        setPendingInvokedSkill((skill) =>
          skill?.id === metadata?.invoked_skill_id ? null : skill,
        );
        closeSlash();
        updateState();
      } catch {
        // The rejected send thunk owns the error toast; keep the draft for retry.
      } finally {
        sendingRef.current = false;
        focusAfterSendRef.current = true;
        setIsSending(false);
      }
    },
    [onSend, closeSlash, updateState],
  );

  const handleSend = useCallback(async () => {
    if (sendingRef.current) return;
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
      el.innerHTML = "";
      updateState();
      return;
    }

    const fileIds = pendingFiles.filter((f) => f.fileId).map((f) => f.fileId!);

    // A leading "/name" the popup never got to resolve still invokes the skill.
    // Everything after it stays the user's own turn: the skill body rides the
    // system prompt, user text must not.
    const leadingCommand = pendingInvokedSkill
      ? null
      : matchChatSkillCommand(trimmed, runnableSkills);
    const invokedSkill = pendingInvokedSkill ?? leadingCommand?.skill ?? null;
    const body = leadingCommand ? leadingCommand.rest : trimmed;

    if (!body && fileIds.length === 0 && !invokedSkill) return;

    // Attached files become inline mentions so they render as chips and the agent
    // receives the file URN, not just the raw attachment. Skip any already mentioned.
    const attachmentMentions = pendingFiles
      .filter((f) => Boolean(f.fileId) && !body.includes(f.fileId!))
      .map((f) => `[[[${sanitizeMentionLabel(f.name)}|urn:uniffy:content:FILE:${f.fileId!}]]]`)
      .join(" ");
    const content = attachmentMentions
      ? body
        ? `${body} ${attachmentMentions}`
        : attachmentMentions
      : body;

    const metadata = invokedSkill
      ? {
          invoked_skill_id: invokedSkill.id,
          invoked_skill_name: invokedSkill.name,
        }
      : undefined;

    // Confirmation cancellation and rejected sends must leave the draft intact.
    const broadcastKinds = broadcastMentionsIn(content);
    if (broadcastKinds.length > 0) {
      const kind = effectiveBroadcastKind(broadcastKinds);
      const memberCount = channel?.memberCount ?? 0;
      const threshold = orgPolicy?.broadcastConfirmThreshold ?? DEFAULT_BROADCAST_CONFIRM_THRESHOLD;
      if (kind && memberCount > threshold) {
        setPendingBroadcastSend({ content, fileIds, metadata, kind, memberCount });
        return;
      }
    }

    const mentionedTeams = teamMentionsIn(content);
    if (mentionedTeams.length > 0 && organizationId) {
      const { total, labels } = await resolveTeamMentionTotal(mentionedTeams, organizationId);
      if (needsTeamMentionConfirm(total)) {
        setPendingTeamSend({ content, fileIds, metadata, total, labels });
        return;
      }
    }

    performSend(content, fileIds, metadata);
  }, [
    performSend,
    updateState,
    pendingFiles,
    editingMessage,
    onSaveEdit,
    onCancelEdit,
    pendingInvokedSkill,
    runnableSkills,
    organizationId,
    channel?.memberCount,
    orgPolicy?.broadcastConfirmThreshold,
  ]);

  const handleTeamSendConfirm = useCallback(() => {
    if (!pendingTeamSend) return;
    const { content, fileIds, metadata } = pendingTeamSend;
    setPendingTeamSend(null);
    performSend(content, fileIds, metadata);
  }, [pendingTeamSend, performSend]);

  const handleTeamSendCancel = useCallback(() => {
    setPendingTeamSend(null);
    editorRef.current?.focus();
  }, []);

  const handleBroadcastSendConfirm = useCallback(() => {
    if (!pendingBroadcastSend) return;
    const { content, fileIds, metadata } = pendingBroadcastSend;
    setPendingBroadcastSend(null);
    performSend(content, fileIds, metadata);
  }, [pendingBroadcastSend, performSend]);

  const handleBroadcastSendCancel = useCallback(() => {
    setPendingBroadcastSend(null);
    editorRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Backspace after a chip deletes it; contentEditable=false elements aren't auto-removed.
      if (e.key === "Backspace" && !e.shiftKey) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
          const range = sel.getRangeAt(0);
          const node = range.startContainer;
          const offset = range.startOffset;

          const findChipBefore = (): HTMLElement | null => {
            if (node.nodeType === Node.TEXT_NODE) {
              if (offset !== 0) return null;
              const prev = node.previousSibling;
              return prev &&
                prev.nodeType === Node.ELEMENT_NODE &&
                (prev as HTMLElement).hasAttribute(MENTION_ATTR)
                ? (prev as HTMLElement)
                : null;
            }
            if (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
              const prev = (node as HTMLElement).childNodes[offset - 1];
              return prev &&
                prev.nodeType === Node.ELEMENT_NODE &&
                (prev as HTMLElement).hasAttribute(MENTION_ATTR)
                ? (prev as HTMLElement)
                : null;
            }
            return null;
          };

          const chip = findChipBefore();
          if (chip) {
            e.preventDefault();
            chip.remove();
            updateState();
            emitDraftChange();
            return;
          }
        }
      }

      // Edit-last (Slack-style) only fires when compose is idle; otherwise the keystroke belongs to the editor.
      if (
        onEditLast &&
        editLastBinding &&
        isEmpty &&
        !editingMessage &&
        !replyTo &&
        !mentionActive &&
        pendingFiles.length === 0 &&
        matchesShortcut(e.nativeEvent, editLastBinding)
      ) {
        e.preventDefault();
        onEditLast();
        return;
      }

      if (mentionActive && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        return;
      }

      // The slash popup's own document listener turns Enter into a selection and
      // Escape into a close; the composer only has to not send / not cancel.
      if (slashActive && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        return;
      }

      // An Escape consumed here must not also reach the document listeners of
      // the overlays under the composer (thread slide-over, dialogs).
      if (e.key === "Escape") {
        if (mentionActive) {
          e.stopPropagation();
          handleMentionClose();
          return;
        }
        if (slashActive) {
          return;
        }
        if (editingMessage) {
          e.stopPropagation();
          onCancelEdit?.();
          return;
        }
        if (replyTo) {
          e.stopPropagation();
          onCancelReply?.();
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;

        const range = sel.getRangeAt(0);
        const selected = range.toString();

        let wrapped: string | null = null;

        if (e.key === "b") {
          e.preventDefault();
          wrapped = `**${selected}**`;
        } else if (e.key === "i") {
          e.preventDefault();
          wrapped = `*${selected}*`;
        }

        if (wrapped !== null && selected.length > 0) {
          range.deleteContents();
          range.insertNode(document.createTextNode(wrapped));
          range.collapse(false);
          updateState();
          emitDraftChange();
        }
      }
    },
    [
      mentionActive,
      slashActive,
      handleSend,
      handleMentionClose,
      updateState,
      emitDraftChange,
      replyTo,
      onCancelReply,
      editingMessage,
      onCancelEdit,
      isEmpty,
      pendingFiles.length,
      onEditLast,
      editLastBinding,
    ],
  );

  const handleAtButtonClick = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;

    el.focus();

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);

    const atText = document.createTextNode("@");
    range.deleteContents();
    range.insertNode(atText);

    range.setStartAfter(atText);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);

    mentionStartNodeRef.current = atText;
    mentionStartOffsetRef.current = 0;
    setMentionQuery("");
    setMentionActive(true);
  }, []);

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
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
      emitDraftChange();
      setShowEmojiPicker(false);
    },
    [updateState, emitDraftChange],
  );

  const handleCodeBlockInsert = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const codeBlock = document.createTextNode("```\n\n```");
      range.deleteContents();
      range.insertNode(codeBlock);
      range.setStart(codeBlock, 4); // after the opening ``` and newline
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    updateState();
    emitDraftChange();
  }, [updateState, emitDraftChange]);

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
      const marker = document.createTextNode("**text**");
      range.deleteContents();
      range.insertNode(marker);
      // Select "text" so the next keystroke replaces it.
      range.setStart(marker, 2);
      range.setEnd(marker, 6);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    updateState();
    emitDraftChange();
  }, [updateState, emitDraftChange]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      if (el.scrollHeight > MAX_HEIGHT) {
        el.style.maxHeight = `${MAX_HEIGHT}px`;
        el.style.overflowY = "auto";
      } else {
        el.style.maxHeight = "";
        el.style.overflowY = "";
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const toolbarButtonClass =
    "p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors";

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
        ref={composeRef}
        className={cn(
          "relative bg-card/60 backdrop-blur-lg backdrop-saturate-150 shadow-float",
          "focus-ring-within transition-all",
          variant === "hero" ? "rounded-2xl" : "mx-4 mb-4 rounded-xl",
        )}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        data-testid="chat-compose-root"
        inert={isSending}
        data-mode={editingMessage ? "edit" : replyTo ? "reply" : "normal"}
        data-variant={variant}
      >
        {slashActive && !!skillAgentId && (
          <SkillSlashPopup
            skills={runnableSkills}
            query={slashQuery}
            onSelect={handleSlashSelect}
            onClose={handleSlashClose}
          />
        )}
        {editingMessage && (
          <div
            className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border/50 bg-primary/5 rounded-t-xl"
            data-testid="chat-compose-edit-banner"
          >
            <div className="flex items-center gap-2 min-w-0 text-xs">
              <Pencil size={14} className="shrink-0 text-primary" />
              <span className="text-muted-foreground shrink-0">Editing message</span>
              <span className="text-subtle-foreground hidden sm:inline">
                Escape to cancel, Enter to save
              </span>
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

        {replyTo && !editingMessage && (
          <div
            className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border/50 bg-muted/40 rounded-t-xl"
            data-testid="chat-compose-reply-banner"
          >
            <div className="flex items-center gap-2 min-w-0 text-xs">
              <ArrowBendUpLeft size={14} className="shrink-0 text-primary" />
              <span className="text-muted-foreground shrink-0">Replying to</span>
              <span className="font-semibold text-foreground truncate">{replyTo.senderName}</span>
              <span className="text-subtle-foreground truncate hidden sm:inline">
                {replyTo.contentPreview}
              </span>
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

        {pendingInvokedSkill && !editingMessage && (
          <div className="px-4 pt-2" data-testid="chat-compose-skill-chip">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 border border-primary/30 pl-2 pr-1 py-1 text-xs">
              <Lightning size={12} weight="fill" className="text-primary" />
              <span className="font-mono text-foreground">/{pendingInvokedSkill.name}</span>
              <button
                type="button"
                onClick={() => setPendingInvokedSkill(null)}
                className="p-0.5 rounded hover:bg-primary/20 transition-colors"
                title="Remove skill"
                data-testid="chat-compose-skill-chip-remove"
              >
                <X size={12} className="text-muted-foreground" />
              </button>
            </span>
          </div>
        )}

        {charCount >= CHAR_WARN_THRESHOLD && (
          <div className="flex justify-end px-4 pt-1">
            <span className="text-xs text-muted-foreground">
              {charCount.toLocaleString()} characters
            </span>
          </div>
        )}

        <div className="relative">
          {isEmpty && (
            <div className="absolute px-4 pt-3 pb-2 text-[14.5px] leading-[1.45] text-muted-foreground pointer-events-none select-none">
              {displayPlaceholder}
            </div>
          )}

          <div
            ref={editorRef}
            contentEditable={!isSending}
            aria-busy={isSending}
            role="textbox"
            aria-label={displayPlaceholder}
            aria-multiline="true"
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className="w-full px-4 pt-3 pb-2 text-[14.5px] leading-[1.45] min-h-[40px] outline-none text-foreground break-words whitespace-pre-wrap"
            suppressContentEditableWarning
            data-testid="chat-compose-input"
            data-empty={isEmpty ? "true" : "false"}
          />
        </div>

        <AttachmentPreviewBar files={pendingFiles} onRemove={handleRemovePendingFile} />

        <div className="flex items-center justify-between px-2 py-1.5 border-t border-border/50">
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
              data-state={showEmojiPicker ? "open" : "closed"}
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
            {!agentDmAgent && (
              <button
                type="button"
                className={toolbarButtonClass}
                aria-label="Insert code block"
                onClick={handleCodeBlockInsert}
                data-testid="chat-compose-code-button"
              >
                <Code size={18} />
              </button>
            )}
            {channelId && agentDmAgent && (
              <>
                <AgentModelPicker
                  channelId={channelId}
                  agent={agentDmAgent}
                  config={agentConfig.config}
                  updating={agentConfig.updating}
                  update={agentConfig.update}
                />
                <AgentParamsPopover
                  agent={agentDmAgent}
                  config={agentConfig.config}
                  updating={agentConfig.updating}
                  update={agentConfig.update}
                />
              </>
            )}
          </div>

          <div className="flex items-center gap-0.5">
            {!agentDmAgent && (
              <button
                type="button"
                className={toolbarButtonClass}
                aria-label="Toggle formatting"
                onClick={handleBoldInsert}
                data-testid="chat-compose-bold-button"
              >
                <TextB size={18} />
              </button>
            )}
            {sendOption && (
              <Checkbox
                size="sm"
                className="mr-1 min-w-0"
                label={sendOption.label}
                labelClassName="truncate"
                checked={sendOption.checked}
                onChange={(e) => sendOption.onChange(e.target.checked)}
                data-testid="chat-compose-also-send-to-channel"
              />
            )}
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending || (isEmpty && !pendingInvokedSkill)}
              aria-label="Send message"
              className={cn(
                "p-1.5 rounded-md transition-colors",
                !isEmpty
                  ? "text-primary hover:bg-primary/10 cursor-pointer"
                  : "text-subtle-foreground cursor-not-allowed",
              )}
              data-testid="chat-compose-send-button"
              data-disabled={isEmpty ? "true" : "false"}
            >
              <PaperPlaneRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {mentionActive && (
        <ChatMentionPopup
          initialQuery={mentionQuery}
          onSelect={handleMentionSelect}
          onClose={handleMentionClose}
          staticEntries={broadcastEntries}
        />
      )}

      {pendingTeamSend && (
        <ConfirmDialog
          isOpen
          onClose={handleTeamSendCancel}
          onConfirm={handleTeamSendConfirm}
          title="Notify team members?"
          message={`This mentions ${pendingTeamSend.labels.join(", ")}. Up to ${pendingTeamSend.total} people will be notified.`}
          confirmLabel="Send"
          variant="default"
        />
      )}

      {pendingBroadcastSend && (
        <ConfirmDialog
          isOpen
          onClose={handleBroadcastSendCancel}
          onConfirm={handleBroadcastSendConfirm}
          title="Notify the whole channel?"
          message={
            pendingBroadcastSend.kind === "here"
              ? `This mentions @here. Members online right now, out of ${pendingBroadcastSend.memberCount} in the channel, will be notified.`
              : `This mentions @${pendingBroadcastSend.kind}. Up to ${pendingBroadcastSend.memberCount} people will be notified.`
          }
          confirmLabel="Send"
          variant="default"
        />
      )}
    </>
  );
}
