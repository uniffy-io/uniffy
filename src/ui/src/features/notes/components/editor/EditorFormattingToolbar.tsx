import { useCallback, useMemo, useRef, useState } from "react";
import {
  TextB,
  TextItalic,
  TextUnderline,
  TextStrikethrough,
  Code,
  Link,
  ListBullets,
  ListNumbers,
  CodeBlock,
  ArrowCounterClockwise,
  ArrowClockwise,
  At,
  Highlighter,
  Smiley,
  ChatCircle,
} from "@phosphor-icons/react";
import { EmojiPicker } from "@/features/chat/components/compose/EmojiPicker";
import { LinkPrompt } from "@/features/notes/components/editor/toolbar/LinkPrompt";
import { useFormattedKeybinding } from "@/features/settings";
import { editorViewCtx } from "@milkdown/core";
import { useAppSelector } from "@/app/hooks";
import { useEditorHandle } from "@/components/editor/EditorHandle";
import { useActiveMarks } from "@/features/notes/components/editor/toolbar/useActiveMarks";
import { toolbarCommands } from "@/features/notes/components/editor/toolbar/toolbarCommands";
import {
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/features/notes/components/editor/toolbar/ToolbarButton";
import { HeadingDropdown } from "@/features/notes/components/editor/toolbar/HeadingDropdown";
import { TablePopover } from "@/features/notes/components/editor/toolbar/TablePopover";
import { InsertExtrasMenu } from "@/features/notes/components/editor/toolbar/InsertExtrasMenu";
import { HighlightPicker } from "@/components/editor/plugins/highlight/HighlightPicker";
import { highlightMark } from "@/components/editor/plugins/highlight";
import { createImageUploadHandler } from "@/components/editor/utils/imageUploader";
import { createVideoUploadHandler } from "@/components/editor/utils/videoUploader";
import { createAudioUploadHandler } from "@/components/editor/utils/audioUploader";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import type { EditorView } from "@milkdown/prose/view";

interface EditorFormattingToolbarProps {
  noteId: string;
}

export function EditorFormattingToolbar({ noteId }: EditorFormattingToolbarProps) {
  const handle = useEditorHandle();
  const active = useActiveMarks();
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
  const [highlightAnchor, setHighlightAnchor] = useState<DOMRect | null>(null);
  const [linkAnchor, setLinkAnchor] = useState<DOMRect | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const undoShortcut = useFormattedKeybinding("editor.undo");
  const redoShortcut = useFormattedKeybinding("editor.redo");

  const uploads = useMemo(() => {
    if (!organizationId) return null;
    return {
      image: createImageUploadHandler(ContentType.NOTE, noteId, organizationId),
      video: createVideoUploadHandler(ContentType.NOTE, noteId, organizationId),
      audio: createAudioUploadHandler(ContentType.NOTE, noteId, organizationId),
    };
  }, [organizationId, noteId]);

  const ready = handle !== null;

  const onHighlightClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!handle) return;
      const rect = e.currentTarget.getBoundingClientRect();
      setHighlightAnchor(rect);
    },
    [handle],
  );

  const insertEmoji = useCallback(
    (emoji: string) => {
      if (!handle) return;
      handle.run((ctx) => {
        const view = ctx.get(editorViewCtx) as EditorView;
        if (!view) return;
        view.dispatch(view.state.tr.insertText(emoji));
      });
      handle.focus();
    },
    [handle],
  );

  const applyHighlight = useCallback(
    (color: string | null) => {
      if (!handle) {
        setHighlightAnchor(null);
        return;
      }
      handle.run((ctx) => {
        const view = ctx.get(editorViewCtx) as EditorView;
        if (!view) return;
        const { from, to } = view.state.selection;
        if (from === to) return;
        const markType = highlightMark.type(ctx);
        let tr = view.state.tr.removeMark(from, to, markType);
        if (color !== null) tr = tr.addMark(from, to, markType.create({ color }));
        view.dispatch(tr);
      });
      handle.focus();
      setHighlightAnchor(null);
    },
    [handle],
  );

  return (
    <div className="flex flex-wrap items-center gap-1 px-3 py-1 bg-muted/40 border-b border-border/50">
      <HeadingDropdown />
      <ToolbarSeparator />

      <ToolbarGroup>
        <ToolbarButton
          active={active.bold}
          disabled={!ready}
          onClick={() => handle && toolbarCommands.toggleBold(handle)}
          label="Bold"
        >
          <TextB size={14} weight="bold" />
        </ToolbarButton>
        <ToolbarButton
          active={active.italic}
          disabled={!ready}
          onClick={() => handle && toolbarCommands.toggleItalic(handle)}
          label="Italic"
        >
          <TextItalic size={14} weight="bold" />
        </ToolbarButton>
        <ToolbarButton
          active={active.underline}
          disabled={!ready}
          onClick={() => handle && toolbarCommands.toggleUnderline(handle)}
          label="Underline"
        >
          <TextUnderline size={14} weight="bold" />
        </ToolbarButton>
        <span className="hidden sm:contents">
          <ToolbarButton
            active={active.strike}
            disabled={!ready}
            onClick={() => handle && toolbarCommands.toggleStrike(handle)}
            label="Strikethrough"
          >
            <TextStrikethrough size={14} weight="bold" />
          </ToolbarButton>
          <ToolbarButton
            active={active.code}
            disabled={!ready}
            onClick={() => handle && toolbarCommands.toggleInlineCode(handle)}
            label="Inline code"
          >
            <Code size={14} weight="bold" />
          </ToolbarButton>
          <ToolbarButton
            active={active.link || linkAnchor !== null}
            disabled={!ready}
            onClick={(e) => {
              if (!handle) return;
              setLinkAnchor(e.currentTarget.getBoundingClientRect());
            }}
            label="Link"
          >
            <Link size={14} weight="bold" />
          </ToolbarButton>
        </span>
      </ToolbarGroup>

      <span className="hidden md:contents">
        <ToolbarSeparator />

        <ToolbarGroup>
          <ToolbarButton
            active={active.bulletList}
            disabled={!ready}
            onClick={() => handle && toolbarCommands.toggleBulletList(handle)}
            label="Bulleted list"
          >
            <ListBullets size={14} weight="bold" />
          </ToolbarButton>
          <ToolbarButton
            active={active.orderedList}
            disabled={!ready}
            onClick={() => handle && toolbarCommands.toggleOrderedList(handle)}
            label="Numbered list"
          >
            <ListNumbers size={14} weight="bold" />
          </ToolbarButton>
          <ToolbarButton
            active={active.codeBlock}
            disabled={!ready}
            onClick={() => handle && toolbarCommands.insertCodeBlock(handle)}
            label="Code block"
          >
            <CodeBlock size={14} weight="bold" />
          </ToolbarButton>
          <TablePopover />
        </ToolbarGroup>

        <ToolbarSeparator />

        <ToolbarGroup>
          <ToolbarButton disabled={!ready} onClick={onHighlightClick} label="Highlight">
            <Highlighter size={14} weight="bold" />
          </ToolbarButton>
          <ToolbarButton
            ref={emojiButtonRef}
            active={emojiOpen}
            disabled={!ready}
            onClick={() => setEmojiOpen((v) => !v)}
            label="Emoji"
          >
            <Smiley size={14} weight="bold" />
          </ToolbarButton>
          <ToolbarButton
            disabled={!ready}
            onClick={() => handle && toolbarCommands.triggerMention(handle)}
            label="Mention"
          >
            <At size={14} weight="bold" />
          </ToolbarButton>
          {handle?.triggerComment && (
            <ToolbarButton
              disabled={!ready}
              onClick={() => handle.triggerComment?.()}
              label="Comment on selection"
            >
              <ChatCircle size={14} weight="bold" />
            </ToolbarButton>
          )}
          <InsertExtrasMenu
            imageUpload={uploads?.image}
            videoUpload={uploads?.video}
            audioUpload={uploads?.audio}
          />
        </ToolbarGroup>

        <ToolbarSeparator />
      </span>

      <span className="md:hidden">
        <InsertExtrasMenu
          imageUpload={uploads?.image}
          videoUpload={uploads?.video}
          audioUpload={uploads?.audio}
        />
      </span>

      <ToolbarGroup>
        <ToolbarButton
          disabled={!ready}
          onClick={() => handle && toolbarCommands.undo(handle)}
          label={undoShortcut ? `Undo (${undoShortcut})` : "Undo"}
        >
          <ArrowCounterClockwise size={14} weight="bold" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!ready}
          onClick={() => handle && toolbarCommands.redo(handle)}
          label={redoShortcut ? `Redo (${redoShortcut})` : "Redo"}
        >
          <ArrowClockwise size={14} weight="bold" />
        </ToolbarButton>
      </ToolbarGroup>

      {highlightAnchor && (
        <HighlightPicker
          anchorRect={highlightAnchor}
          onSelect={applyHighlight}
          onClose={() => setHighlightAnchor(null)}
        />
      )}

      {emojiOpen && (
        <EmojiPicker
          anchorRef={emojiButtonRef}
          onSelect={insertEmoji}
          onClose={() => setEmojiOpen(false)}
        />
      )}

      {linkAnchor && handle && (
        <LinkPrompt handle={handle} anchorRect={linkAnchor} onClose={() => setLinkAnchor(null)} />
      )}
    </div>
  );
}
