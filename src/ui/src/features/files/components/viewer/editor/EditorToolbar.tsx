import {
  ArrowCounterClockwise,
  ArrowClockwise,
  FlipHorizontal,
  FlipVertical,
  Crop,
  Sun,
  CircleHalf,
  ArrowUUpLeft,
  ArrowUUpRight,
  X,
  Check,
  FloppyDisk,
  ArrowsCounterClockwise,
} from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useFormattedKeybinding } from "@/features/settings";

interface EditorToolbarProps {
  // Transform state
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  brightness: number;
  contrast: number;

  // Crop state
  cropActive: boolean;
  cropRect: { x: number; y: number; width: number; height: number } | null;

  // History state
  canUndo: boolean;
  canRedo: boolean;
  hasChanges: boolean;

  // Saving state
  isSaving: boolean;

  onRotateLeft: () => void;
  onRotateRight: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onBrightnessChange: (value: number) => void;
  onBrightnessCommit: () => void;
  onContrastChange: (value: number) => void;
  onContrastCommit: () => void;
  onToggleCrop: () => void;
  onApplyCrop: () => void;
  onCancelCrop: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export function EditorToolbar({
  rotation,
  flipH,
  flipV,
  brightness,
  contrast,
  cropActive,
  cropRect,
  canUndo,
  canRedo,
  hasChanges,
  isSaving,
  onRotateLeft,
  onRotateRight,
  onFlipH,
  onFlipV,
  onBrightnessChange,
  onBrightnessCommit,
  onContrastChange,
  onContrastCommit,
  onToggleCrop,
  onApplyCrop,
  onCancelCrop,
  onUndo,
  onRedo,
  onReset,
  onSave,
  onCancel,
}: EditorToolbarProps) {
  // Keyboard shortcuts
  const undoShortcut = useFormattedKeybinding("imageEditor.undo");
  const redoShortcut = useFormattedKeybinding("imageEditor.redo");
  const saveShortcut = useFormattedKeybinding("imageEditor.save");
  const cancelShortcut = useFormattedKeybinding("imageEditor.cancel");

  return (
    <div className="editor-toolbar flex items-center gap-2 px-4 py-2 bg-black/40 backdrop-blur-sm border-b border-white/10">
      {/* Left: Cancel button */}
      <div className="flex items-center">
        <button
          onClick={onCancel}
          className="editor-btn flex items-center gap-1.5 px-3 py-1.5 text-sm hover:bg-white/10 rounded-md transition-colors"
          title={cancelShortcut ? `Cancel (${cancelShortcut})` : "Cancel editing"}
          disabled={isSaving}
        >
          <X size={16} weight="bold" />
          <span>Cancel</span>
        </button>
      </div>

      {/* Center: Tools */}
      <div className="flex-1 flex items-center justify-center gap-1">
        {/* Undo/Redo */}
        <div className="flex items-center gap-0.5 mr-2">
          <ToolButton
            icon={<ArrowUUpLeft size={18} />}
            onClick={onUndo}
            disabled={!canUndo || isSaving}
            title={undoShortcut ? `Undo (${undoShortcut})` : "Undo"}
          />
          <ToolButton
            icon={<ArrowUUpRight size={18} />}
            onClick={onRedo}
            disabled={!canRedo || isSaving}
            title={redoShortcut ? `Redo (${redoShortcut})` : "Redo"}
          />
          <ToolButton
            icon={<ArrowsCounterClockwise size={18} />}
            onClick={onReset}
            disabled={!hasChanges || isSaving}
            title="Reset to original"
          />
        </div>

        <div className="w-px h-5 bg-white/20 mx-1" />

        {/* Rotation */}
        <div className="flex items-center gap-0.5">
          <ToolButton
            icon={<ArrowCounterClockwise size={18} />}
            onClick={onRotateLeft}
            disabled={isSaving}
            title="Rotate left (Shift+R)"
          />
          <ToolButton
            icon={<ArrowClockwise size={18} />}
            onClick={onRotateRight}
            disabled={isSaving}
            title="Rotate right (R)"
            active={rotation !== 0}
          />
        </div>

        <div className="w-px h-5 bg-white/20 mx-1" />

        {/* Flip */}
        <div className="flex items-center gap-0.5">
          <ToolButton
            icon={<FlipHorizontal size={18} />}
            onClick={onFlipH}
            disabled={isSaving}
            title="Flip horizontal (H)"
            active={flipH}
          />
          <ToolButton
            icon={<FlipVertical size={18} />}
            onClick={onFlipV}
            disabled={isSaving}
            title="Flip vertical (V)"
            active={flipV}
          />
        </div>

        <div className="w-px h-5 bg-white/20 mx-1" />

        {/* Crop */}
        <div className="flex items-center gap-0.5">
          <ToolButton
            icon={<Crop size={18} />}
            onClick={onToggleCrop}
            disabled={isSaving}
            title="Crop (C)"
            active={cropActive}
          />
          {cropActive && cropRect && (
            <>
              <ToolButton
                icon={<Check size={18} />}
                onClick={onApplyCrop}
                disabled={isSaving}
                title="Apply crop (Enter)"
                className="text-green-400 hover:text-green-300"
              />
              <ToolButton
                icon={<X size={18} />}
                onClick={onCancelCrop}
                disabled={isSaving}
                title="Cancel crop (Escape)"
                className="text-red-400 hover:text-red-300"
              />
            </>
          )}
        </div>

        <div className="w-px h-5 bg-white/20 mx-1" />

        {/* Adjustments */}
        <div className="flex items-center gap-3">
          <AdjustmentSlider
            icon={<Sun size={16} />}
            label="Brightness"
            value={brightness}
            onChange={onBrightnessChange}
            onCommit={onBrightnessCommit}
            disabled={isSaving}
          />
          <AdjustmentSlider
            icon={<CircleHalf size={16} />}
            label="Contrast"
            value={contrast}
            onChange={onContrastChange}
            onCommit={onContrastCommit}
            disabled={isSaving}
          />
        </div>
      </div>

      {/* Right: Save button */}
      <div className="flex items-center">
        <button
          onClick={onSave}
          disabled={!hasChanges || isSaving}
          className={cn(
            "editor-btn flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors",
            hasChanges && !isSaving
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-white/10 text-white/50 cursor-not-allowed",
          )}
          title={saveShortcut ? `Save (${saveShortcut})` : "Save changes"}
        >
          <FloppyDisk size={16} weight="bold" />
          <span>{isSaving ? "Saving..." : "Save"}</span>
        </button>
      </div>
    </div>
  );
}

interface ToolButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  active?: boolean;
  className?: string;
}

function ToolButton({ icon, onClick, disabled, title, active, className }: ToolButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "p-2 rounded-md transition-colors",
        disabled
          ? "text-white/30 cursor-not-allowed"
          : active
            ? "bg-primary/20 text-primary"
            : "text-white/70 hover:text-white hover:bg-white/10",
        className,
      )}
    >
      {icon}
    </button>
  );
}

interface AdjustmentSliderProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit: () => void;
  disabled?: boolean;
}

function AdjustmentSlider({
  icon,
  label,
  value,
  onChange,
  onCommit,
  disabled,
}: AdjustmentSliderProps) {
  return (
    <div className="flex items-center gap-2" title={label}>
      <span className={cn("text-white/70", disabled && "text-white/30")}>{icon}</span>
      <input
        type="range"
        min={-100}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={onCommit}
        onTouchEnd={onCommit}
        disabled={disabled}
        className={cn(
          "w-20 h-1 rounded-full appearance-none cursor-pointer",
          "bg-white/20 accent-primary",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      />
      <span
        className={cn(
          "text-xs w-8 text-right tabular-nums",
          disabled ? "text-white/30" : "text-white/60",
        )}
      >
        {value > 0 ? "+" : ""}
        {value}
      </span>
    </div>
  );
}
