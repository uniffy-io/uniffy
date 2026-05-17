import { commandsCtx, editorViewCtx } from '@milkdown/core';
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark';
import type { Ctx } from '@milkdown/kit/ctx';
import type { EditorView } from '@milkdown/prose/view';
import { TOC_DEFAULTS } from '@/components/editor/plugins/toc/tocTypes';

export type UploadHandler = (file: File) => Promise<string>;

function clearCurrentBlock(ctx: Ctx) {
  const commands = ctx.get(commandsCtx);
  commands.call(clearTextInCurrentBlockCommand.key);
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    const cleanup = () => input.remove();
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      cleanup();
      resolve(file);
    });
    input.addEventListener('cancel', () => {
      cleanup();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

function placeholderId(prefix: string): string {
  return `${prefix}:${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface FoundBlock {
  pos: number;
  size: number;
}

function findBlockByAttr(view: EditorView, nodeName: string, attr: string, value: string): FoundBlock | null {
  let found: FoundBlock | null = null;
  view.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === nodeName && node.attrs[attr] === value) {
      found = { pos, size: node.nodeSize };
      return false;
    }
  });
  return found;
}

function replaceCurrentBlockWith(view: EditorView, makeNode: (schema: EditorView['state']['schema']) => ReturnType<EditorView['state']['schema']['node']> | null) {
  const node = makeNode(view.state.schema);
  if (!node) return;
  const { $from } = view.state.selection;
  const tr = view.state.tr.replaceRangeWith($from.before(), $from.after(), node);
  view.dispatch(tr);
}

export function insertTocBlock(ctx: Ctx) {
  clearCurrentBlock(ctx);
  const view = ctx.get(editorViewCtx) as EditorView;
  if (!view) return;
  replaceCurrentBlockWith(view, (schema) => {
    const tocType = schema.nodes.toc_block;
    return tocType ? tocType.create({ ...TOC_DEFAULTS }) : null;
  });
}

function updateMediaBlockSrc(view: EditorView, nodeName: string, oldSrc: string, newSrc: string, title?: string) {
  const found = findBlockByAttr(view, nodeName, 'src', oldSrc);
  if (!found) return;
  const attrs: Record<string, string> = { src: newSrc };
  if (title) attrs.title = title;
  view.dispatch(view.state.tr.setNodeMarkup(found.pos, null, attrs));
}

function removeMediaBlock(view: EditorView, nodeName: string, src: string) {
  const found = findBlockByAttr(view, nodeName, 'src', src);
  if (!found) return;
  view.dispatch(view.state.tr.delete(found.pos, found.pos + found.size));
}

async function insertMediaWithUpload(
  ctx: Ctx,
  options: {
    nodeName: 'video_block' | 'audio_block';
    accept: string;
    upload: UploadHandler;
    logLabel: string;
  },
) {
  clearCurrentBlock(ctx);
  const view = ctx.get(editorViewCtx) as EditorView;
  if (!view) return;

  const placeholder = placeholderId('uploading');
  replaceCurrentBlockWith(view, (schema) => {
    const type = schema.nodes[options.nodeName];
    return type ? type.create({ src: placeholder }) : null;
  });

  const file = await pickFile(options.accept);
  if (!file) {
    removeMediaBlock(view, options.nodeName, placeholder);
    return;
  }
  try {
    const url = await options.upload(file);
    updateMediaBlockSrc(view, options.nodeName, placeholder, url, file.name);
  } catch (error) {
    console.error(`[insertBlocks] Failed to upload ${options.logLabel}:`, error);
    removeMediaBlock(view, options.nodeName, placeholder);
  }
}

export function insertVideoBlock(ctx: Ctx, upload: UploadHandler) {
  void insertMediaWithUpload(ctx, {
    nodeName: 'video_block',
    accept: 'video/*',
    upload,
    logLabel: 'video',
  });
}

export function insertAudioBlock(ctx: Ctx, upload: UploadHandler) {
  void insertMediaWithUpload(ctx, {
    nodeName: 'audio_block',
    accept: 'audio/*',
    upload,
    logLabel: 'audio',
  });
}

export function insertAudioRecording(ctx: Ctx) {
  clearCurrentBlock(ctx);
  const view = ctx.get(editorViewCtx) as EditorView;
  if (!view) return;
  const recordingId = `rec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  replaceCurrentBlockWith(view, (schema) => {
    const type = schema.nodes.audio_recording;
    return type ? type.create({ recordingId }) : null;
  });
}

export async function insertImageBlock(ctx: Ctx, upload: UploadHandler) {
  const file = await pickFile('image/*');
  if (!file) return;
  const view = ctx.get(editorViewCtx) as EditorView;
  if (!view) return;
  try {
    const url = await upload(file);
    const { schema } = view.state;
    const imageType = schema.nodes['image-block'] ?? schema.nodes.image;
    const node = imageType?.createAndFill?.({ src: url, alt: file.name });
    if (!node) return;
    const tr = view.state.tr.replaceSelectionWith(node);
    view.dispatch(tr);
  } catch (error) {
    console.error('[insertBlocks] Failed to upload image:', error);
  }
}
