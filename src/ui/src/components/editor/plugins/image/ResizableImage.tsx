import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowsOutSimple, ArrowCounterClockwise, TextT } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { popoverShellClass } from "@/components/ui/popover";
import { cn } from "@/shared/utils/cn";

interface ResizableImageProps {
  src: string;
  caption: string;
  ratio: number;
  selected: boolean;
  editable: boolean;
  onScale: (ratio: number) => void;
  onCaption: (caption: string) => void;
}

function clampScale(ratio: number) {
  return Math.round(Math.max(0.01, Math.min(4, ratio)) * 100) / 100;
}

export function ResizableImage({
  src,
  caption,
  ratio,
  selected,
  editable,
  onScale,
  onCaption,
}: ResizableImageProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [previewScale, setPreviewScale] = useState<number | null>(null);
  const [showCaption, setShowCaption] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    scale: number;
    width: number;
    height: number;
  } | null>(null);
  const scale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const displayedScale = previewScale ?? scale;
  const percent = Math.round(displayedScale * 100);
  const controlsVisible = editable && selected;

  const dragScale = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return scale;
    // A centered image grows on both horizontal edges; its top edge stays fixed.
    const horizontal = ((event.clientX - drag.x) * 2) / drag.width;
    const vertical = (event.clientY - drag.y) / drag.height;
    const delta = Math.abs(horizontal) > Math.abs(vertical) ? horizontal : vertical;
    return clampScale(drag.scale + delta);
  };

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const image = imageRef.current;
    if (!editable || !image?.naturalWidth || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scale: image.getBoundingClientRect().width / image.naturalWidth,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        next = scale - 0.01;
        break;
      case "ArrowRight":
      case "ArrowUp":
        next = scale + 0.01;
        break;
      case "PageDown":
        next = scale - 0.1;
        break;
      case "PageUp":
        next = scale + 0.1;
        break;
      case "Home":
        next = 0.01;
        break;
      case "End":
        next = 4;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    onScale(clampScale(next));
  };

  return (
    <figure className="editor-image">
      <div className="editor-image-frame">
        <img
          ref={imageRef}
          src={src}
          alt={caption}
          data-type="image-block"
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget;
            setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
          }}
          style={{ width: naturalSize ? naturalSize.width * displayedScale : undefined }}
        />
        {controlsVisible && (
          <>
            <div className="pointer-events-none absolute inset-0 rounded-lg shadow-edge-primary" />
            <div
              role="toolbar"
              aria-label="Image size"
              className={cn(
                popoverShellClass,
                "editor-image-controls flex items-center gap-1 px-2 py-1",
              )}
              onMouseDown={(event) => {
                if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
              }}
            >
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Size
                <NumberInput
                  key={percent}
                  aria-label="Image size percent"
                  title="Percentage of original size"
                  defaultValue={percent}
                  min={1}
                  max={400}
                  step={1}
                  disabled={!naturalSize}
                  className="h-11 w-16 px-2 lg:h-8"
                  onBlur={(event) => {
                    const value = event.currentTarget.valueAsNumber;
                    const next = Number.isFinite(value) ? clampScale(value / 100) : scale;
                    event.currentTarget.value = String(Math.round(next * 100));
                    onScale(next);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                    if (event.key === "Escape") {
                      event.currentTarget.value = String(percent);
                      event.currentTarget.blur();
                      event.stopPropagation();
                    }
                  }}
                />
                %
              </label>
              <Button
                type="button"
                variant="ghost"
                className="h-11 px-2 lg:h-8"
                title="Reset to original size"
                disabled={!naturalSize}
                onClick={() => onScale(1)}
              >
                <ArrowCounterClockwise size={14} />
                Original
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 lg:h-8 lg:w-8"
                aria-label="Edit image caption"
                title="Edit image caption"
                aria-pressed={showCaption}
                onClick={() => setShowCaption((value) => !value)}
              >
                <TextT size={16} />
              </Button>
            </div>
            <div
              role="slider"
              tabIndex={0}
              aria-label="Resize image"
              aria-valuemin={1}
              aria-valuemax={400}
              aria-valuenow={percent}
              aria-valuetext={`${percent}% of original size`}
              title="Drag to resize, or use arrow keys"
              className="editor-image-resize focus-ring"
              onPointerDown={startResize}
              onPointerMove={(event) => {
                if (dragRef.current?.pointerId === event.pointerId) {
                  setPreviewScale(dragScale(event));
                }
              }}
              onPointerUp={(event) => {
                if (dragRef.current?.pointerId !== event.pointerId) return;
                const next = dragScale(event);
                dragRef.current = null;
                setPreviewScale(null);
                onScale(next);
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onLostPointerCapture={() => {
                dragRef.current = null;
                setPreviewScale(null);
              }}
              onKeyDown={resizeWithKeyboard}
            >
              <span className="rounded bg-primary p-1 text-primary-foreground shadow-float">
                <ArrowsOutSimple size={14} />
              </span>
            </div>
          </>
        )}
      </div>
      {controlsVisible && showCaption ? (
        <Input
          key={caption}
          autoFocus
          defaultValue={caption}
          placeholder="Add a caption"
          aria-label="Image caption"
          className="mt-2 h-9 text-center text-sm"
          onBlur={(event) => onCaption(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      ) : caption ? (
        <figcaption>{caption}</figcaption>
      ) : null}
    </figure>
  );
}
