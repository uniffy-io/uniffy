/**
 * MediaNode - Canvas node that displays images, video, or audio.
 *
 * Images render borderless so they take their natural shape (important for
 * transparent PNGs and diagramming). Video uses VideoBlock (Video.js),
 * audio uses AudioBlock (canvas waveform player).
 */

import { memo, useCallback, useMemo } from 'react';
import { type NodeProps, NodeResizer, Handle, Position } from '@xyflow/react';
import { useAppSelector } from '@/app/hooks';
import { buildFileUrl, buildMediaUrl } from '@/shared/utils/fileUrls';
import type { MediaCanvasNode } from '@/features/notes/canvas/types';
import { VideoBlock } from '@/components/editor/plugins/video/VideoBlock';
import { AudioBlock } from '@/components/editor/plugins/audio/AudioBlock';
import { useCanvasCallbacks } from '@/features/notes/canvas/hooks/useCanvasCallbacks';
import { NodeStyleToolbar } from '@/features/notes/canvas/components/NodeStyleToolbar';

export const MediaNode = memo(function MediaNode({
  id,
  data,
  selected,
}: NodeProps<MediaCanvasNode>) {
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const { onNodeStyleChange, readonly } = useCanvasCallbacks();

  const bgColor = data.bgColor || '';
  const borderColor = data.borderColor || '';
  const borderWidth = data.borderWidth;

  const mediaUrl = useMemo(() => {
    if (!organizationId || !data.fileId) return '';
    const mime = data.mimeType || '';
    if (mime.startsWith('image/')) {
      return buildFileUrl(organizationId, data.fileId);
    }
    return buildMediaUrl(organizationId, data.fileId);
  }, [organizationId, data.fileId, data.mimeType]);

  const handleStyleChange = useCallback(
    (updates: Record<string, unknown>) => {
      onNodeStyleChange(id, updates);
    },
    [id, onNodeStyleChange]
  );

  const mime = data.mimeType || '';
  const isImage = mime.startsWith('image/');
  const isVideo = mime.startsWith('video/');
  const isAudio = mime.startsWith('audio/');

  const wrapperStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    ...(bgColor && bgColor !== 'transparent' ? { backgroundColor: bgColor } : {}),
    ...(bgColor === 'transparent' ? { backgroundColor: 'transparent' } : {}),
    ...(borderColor && borderColor !== 'transparent'
      ? { borderColor, borderStyle: 'solid' }
      : borderColor === 'transparent'
        ? { borderColor: 'transparent' }
        : {}),
    ...(borderWidth !== undefined ? { borderWidth: `${borderWidth}px`, borderStyle: 'solid' } : {}),
  };

  const hasCustomStyle = bgColor || borderColor || borderWidth !== undefined;

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={isImage ? 40 : 120}
        minHeight={isImage ? 40 : isAudio ? 60 : 120}
        lineClassName="!border-primary"
        handleClassName="!w-2 !h-2 !bg-primary !border-primary"
      />
      <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2" />
      <Handle type="target" position={Position.Left} className="!bg-primary !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-primary !w-2 !h-2" />

      {/* Images: borderless by default, styled wrapper if custom styles set */}
      {isImage && mediaUrl && (
        <div
          className="w-full h-full rounded-lg overflow-hidden"
          style={hasCustomStyle ? wrapperStyle : undefined}
        >
          <img
            src={mediaUrl}
            alt={data.filename}
            className="w-full h-full object-contain"
            draggable={false}
          />
        </div>
      )}

      {/* Video: VideoBlock player */}
      {isVideo && mediaUrl && (
        <div
          className="w-full h-full nowheel rounded-lg overflow-hidden"
          style={{ minHeight: 120, ...(hasCustomStyle ? wrapperStyle : {}) }}
        >
          <VideoBlock src={mediaUrl} title={data.filename} selected={selected} />
        </div>
      )}

      {/* Audio: AudioBlock waveform player */}
      {isAudio && mediaUrl && (
        <div
          className="w-full h-full nowheel rounded-lg overflow-hidden"
          style={hasCustomStyle ? wrapperStyle : undefined}
        >
          <AudioBlock src={mediaUrl} title={data.filename} selected={selected} />
        </div>
      )}

      {!isImage && !isVideo && !isAudio && (
        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
          Unsupported media type
        </div>
      )}

      {selected && !readonly && (
        <NodeStyleToolbar
          fillColor={bgColor || 'transparent'}
          borderColor={borderColor || 'transparent'}
          borderWidth={borderWidth ?? 0}
          onStyleChange={handleStyleChange}
          fillFieldName="bgColor"
          fillLabel="Background"
        />
      )}
    </>
  );
});
