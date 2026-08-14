import {
  Plus,
  ListBullets,
  VideoCamera,
  SpeakerHigh,
  Microphone,
  Image as ImageIcon,
} from "@phosphor-icons/react";
import { ToolbarButton } from "@/features/notes/components/editor/toolbar/ToolbarButton";
import { ToolbarPopover } from "@/features/notes/components/editor/toolbar/ToolbarPopover";
import { useEditorHandle } from "@/components/editor/EditorHandle";
import {
  insertTocBlock,
  insertVideoBlock,
  insertAudioBlock,
  insertAudioRecording,
  insertImageBlock,
  type UploadHandler,
} from "@/components/editor/commands/insertBlocks";
import { cn } from "@/shared/utils/cn";
import type { ComponentProps, ReactNode } from "react";

interface InsertExtrasMenuProps {
  videoUpload?: UploadHandler;
  audioUpload?: UploadHandler;
  imageUpload?: UploadHandler;
}

interface MenuItemProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function MenuItem({ icon, label, onClick, disabled }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded text-sm w-full text-left hover:bg-muted",
        disabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

type ToolbarTriggerProps = Parameters<ComponentProps<typeof ToolbarPopover>["trigger"]>[0];

function insertTrigger({ disabled }: { disabled: boolean }) {
  return ({ open, onClick, ref }: ToolbarTriggerProps) => (
    <ToolbarButton
      ref={ref}
      onClick={onClick}
      active={open}
      disabled={disabled}
      label="Insert block"
    >
      <Plus size={14} weight="bold" />
    </ToolbarButton>
  );
}

export function InsertExtrasMenu({ videoUpload, audioUpload, imageUpload }: InsertExtrasMenuProps) {
  const handle = useEditorHandle();

  return (
    <ToolbarPopover trigger={insertTrigger({ disabled: !handle })}>
      {(close) => (
        <div className="flex flex-col">
          <MenuItem
            icon={<ListBullets size={16} />}
            label="Table of Contents"
            onClick={() => {
              if (!handle) return;
              handle.run((ctx) => insertTocBlock(ctx));
              handle.focus();
              close();
            }}
          />
          <MenuItem
            icon={<VideoCamera size={16} />}
            label="Video"
            disabled={!videoUpload}
            onClick={() => {
              if (!handle || !videoUpload) return;
              handle.run((ctx) => insertVideoBlock(ctx, videoUpload));
              close();
            }}
          />
          <MenuItem
            icon={<SpeakerHigh size={16} />}
            label="Audio"
            disabled={!audioUpload}
            onClick={() => {
              if (!handle || !audioUpload) return;
              handle.run((ctx) => insertAudioBlock(ctx, audioUpload));
              close();
            }}
          />
          <MenuItem
            icon={<Microphone size={16} />}
            label="Record Audio"
            disabled={!audioUpload}
            onClick={() => {
              if (!handle) return;
              handle.run((ctx) => insertAudioRecording(ctx));
              handle.focus();
              close();
            }}
          />
          {imageUpload && (
            <MenuItem
              icon={<ImageIcon size={16} />}
              label="Image"
              onClick={() => {
                if (!handle) return;
                handle.run((ctx) => void insertImageBlock(ctx, imageUpload));
                close();
              }}
            />
          )}
        </div>
      )}
    </ToolbarPopover>
  );
}
