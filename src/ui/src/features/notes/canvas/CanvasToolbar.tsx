/**
 * Floating toolbar for adding canvas content (text, references,
 * media, shapes, mind maps) and editing per-canvas defaults.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  TextT,
  At,
  Image,
  Rectangle,
  Circle,
  Diamond,
  PaintBrush,
  ArrowCounterClockwise,
  BezierCurve,
  LineSegment,
  Path,
  ArrowBendRightDown,
  TreeStructure,
  Cursor,
  CursorClick,
  Check,
  Sparkle,
  Eye,
  EyeSlash,
} from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { NODE_COLORS, BORDER_WIDTHS } from '@/features/notes/canvas/components/nodeStyleConstants';
import type { CanvasDefaults, EdgeShape } from '@/features/notes/canvas/types';
import type { CanvasCursorsMode } from '@/features/notes/store/editorSlice';
import { AUTO_CURSORS_HIDE_THRESHOLD } from '@/features/notes/store/editorSlice';

interface CanvasToolbarProps {
  onAddTextBlock: () => void;
  onOpenContentPicker?: () => void;
  onAddMediaFile?: (file: File) => void;
  onAddShape?: (shape: 'rect' | 'ellipse' | 'diamond') => void;
  onAddMindMap?: () => void;
  canvasDefaults?: CanvasDefaults;
  onDefaultsChange?: (defaults: CanvasDefaults) => void;
  /** Cursors visibility mode + cycle handler. Omit to hide the
   * button (e.g. when realtime is not attached). */
  cursorsMode?: CanvasCursorsMode;
  onCursorsModeChange?: (next: CanvasCursorsMode) => void;
  /** Live peer count for the ``'auto'`` mode hint. */
  peerCount?: number;
  className?: string;
}

const CURSOR_MODE_OPTIONS: Array<{
  value: CanvasCursorsMode;
  label: string;
  icon: typeof Sparkle;
  description: (peerCount: number) => string;
}> = [
  {
    value: 'auto',
    label: 'Auto',
    icon: Sparkle,
    description: (peerCount) =>
      peerCount > AUTO_CURSORS_HIDE_THRESHOLD
        ? `Hidden (${peerCount} peers)`
        : `Shown (up to ${AUTO_CURSORS_HIDE_THRESHOLD} peers)`,
  },
  {
    value: 'on',
    label: 'Always show',
    icon: Eye,
    description: () => 'Render every collaborator cursor',
  },
  {
    value: 'off',
    label: 'Always hide',
    icon: EyeSlash,
    description: () => 'Never render collaborator cursors',
  },
];

export const CanvasToolbar = memo(function CanvasToolbar({
  onAddTextBlock,
  onOpenContentPicker,
  onAddMediaFile,
  onAddShape,
  onAddMindMap,
  canvasDefaults,
  onDefaultsChange,
  cursorsMode,
  onCursorsModeChange,
  peerCount = 0,
  className,
}: CanvasToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showShapeMenu, setShowShapeMenu] = useState(false);
  const [showDefaultsMenu, setShowDefaultsMenu] = useState(false);
  const [showCursorsMenu, setShowCursorsMenu] = useState(false);
  const [defaultsPanel, setDefaultsPanel] = useState<'bg' | 'border' | 'width' | 'edgeColor' | 'edgeWidth' | 'edgeShape' | false>(false);

  // Close every popover on outside mousedown. One ref covers triggers
  // + panels; per-button clicks already close sibling popovers.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const anyMenuOpen = showShapeMenu || showDefaultsMenu || showCursorsMenu;
  useEffect(() => {
    if (!anyMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && toolbarRef.current?.contains(target)) return;
      setShowShapeMenu(false);
      setShowDefaultsMenu(false);
      setShowCursorsMenu(false);
      setDefaultsPanel(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [anyMenuOpen]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !onAddMediaFile) return;
      onAddMediaFile(file);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [onAddMediaFile]
  );

  const currentBg = canvasDefaults?.bgColor || '';
  const currentBorder = canvasDefaults?.borderColor || '';
  const currentWidth = canvasDefaults?.borderWidth;
  const currentEdgeColor = canvasDefaults?.edgeColor || '';
  const currentEdgeWidth = canvasDefaults?.edgeWidth;
  const currentEdgeShape = canvasDefaults?.edgeShape || '';
  const hasDefaults = currentBg || currentBorder || currentWidth !== undefined || currentEdgeColor || currentEdgeWidth !== undefined || currentEdgeShape;

  return (
    <div
      ref={toolbarRef}
      className={cn(
        'absolute bottom-4 left-1/2 -translate-x-1/2 z-10',
        'flex items-center gap-1 px-2 py-1.5',
        'bg-card border border-border rounded-lg shadow-lg',
        className
      )}
    >
      {/* Text */}
      <button
        onClick={onAddTextBlock}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-foreground"
        title="Add Text Block (T)"
      >
        <TextT size={16} weight="duotone" />
        <span className="hidden sm:inline">Text</span>
      </button>

      <div className="w-px h-5 bg-border" />

      {/* Content picker (@ mention) */}
      <button
        onClick={onOpenContentPicker}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-foreground"
        title="Insert Content (@)"
      >
        <At size={16} weight="duotone" />
        <span className="hidden sm:inline">Insert</span>
      </button>

      {/* Media */}
      <button
        onClick={() => fileInputRef.current?.click()}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-foreground"
        title="Add Image/Video/Audio"
      >
        <Image size={16} weight="duotone" />
        <span className="hidden sm:inline">Media</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      <div className="w-px h-5 bg-border" />

      {/* Shapes */}
      {onAddShape && (
        <div className="relative">
          <button
            onClick={() => { setShowShapeMenu(!showShapeMenu); setShowDefaultsMenu(false); setShowCursorsMenu(false); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-foreground"
            title="Add Shape (S)"
          >
            <Rectangle size={16} weight="duotone" />
            <span className="hidden sm:inline">Shape</span>
          </button>
          {showShapeMenu && (
            <div className="absolute bottom-full left-0 mb-2 flex gap-1 p-1.5 bg-card border border-border rounded-lg shadow-lg">
              <button
                onClick={() => { onAddShape('rect'); setShowShapeMenu(false); }}
                className="p-2 rounded hover:bg-muted transition-colors"
                title="Rectangle"
              >
                <Rectangle size={20} weight="duotone" />
              </button>
              <button
                onClick={() => { onAddShape('ellipse'); setShowShapeMenu(false); }}
                className="p-2 rounded hover:bg-muted transition-colors"
                title="Ellipse"
              >
                <Circle size={20} weight="duotone" />
              </button>
              <button
                onClick={() => { onAddShape('diamond'); setShowShapeMenu(false); }}
                className="p-2 rounded hover:bg-muted transition-colors"
                title="Diamond"
              >
                <Diamond size={20} weight="duotone" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Mind Map */}
      {onAddMindMap && (
        <>
          <div className="w-px h-5 bg-border" />
          <button
            onClick={onAddMindMap}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-foreground"
            title="Add Mind Map"
          >
            <TreeStructure size={16} weight="duotone" />
            <span className="hidden sm:inline">Mind Map</span>
          </button>
        </>
      )}

      {/* Defaults picker */}
      {onDefaultsChange && (
        <>
          <div className="w-px h-5 bg-border" />
          <div className="relative">
            <button
              onClick={() => { setShowDefaultsMenu(!showDefaultsMenu); setShowShapeMenu(false); setShowCursorsMenu(false); setDefaultsPanel(false); }}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md hover:bg-muted transition-colors',
                hasDefaults ? 'text-primary' : 'text-foreground'
              )}
              title="Default styles for new nodes"
            >
              <PaintBrush size={16} weight="duotone" />
              <span className="hidden sm:inline">Defaults</span>
            </button>

            {showDefaultsMenu && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-card border border-border rounded-lg shadow-lg p-2 min-w-[180px]">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
                  New Node Defaults
                </div>

                {/* Background color */}
                <button
                  onClick={() => setDefaultsPanel(defaultsPanel === 'bg' ? false : 'bg')}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors text-left"
                >
                  <span
                    className="w-4 h-4 rounded border border-border shrink-0"
                    style={{ backgroundColor: currentBg && currentBg !== 'transparent' ? currentBg : undefined }}
                  >
                    {(!currentBg || currentBg === 'transparent') && (
                      <span className="flex items-center justify-center h-full text-[7px] text-muted-foreground">/</span>
                    )}
                  </span>
                  <span>Background</span>
                </button>

                {/* Border color */}
                <button
                  onClick={() => setDefaultsPanel(defaultsPanel === 'border' ? false : 'border')}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors text-left"
                >
                  <span
                    className="w-4 h-4 rounded shrink-0"
                    style={{
                      border: currentBorder && currentBorder !== 'transparent'
                        ? `2px solid ${currentBorder}`
                        : '2px dashed hsl(var(--muted-foreground) / 0.4)',
                    }}
                  />
                  <span>Border</span>
                </button>

                {/* Border width */}
                <button
                  onClick={() => setDefaultsPanel(defaultsPanel === 'width' ? false : 'width')}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors text-left"
                >
                  <span className="w-4 h-4 rounded border border-border flex items-center justify-center text-[9px] text-foreground shrink-0">
                    {currentWidth ?? '-'}
                  </span>
                  <span>Width</span>
                </button>

                <div className="h-px bg-border my-1.5" />
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
                  New Edge Defaults
                </div>

                {/* Edge shape */}
                <button
                  onClick={() => setDefaultsPanel(defaultsPanel === 'edgeShape' ? false : 'edgeShape')}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors text-left"
                >
                  <BezierCurve size={14} weight="duotone" className="shrink-0" />
                  <span>Shape</span>
                </button>

                {/* Edge color */}
                <button
                  onClick={() => setDefaultsPanel(defaultsPanel === 'edgeColor' ? false : 'edgeColor')}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors text-left"
                >
                  <span
                    className="w-4 h-4 rounded border border-border shrink-0"
                    style={{ backgroundColor: currentEdgeColor && currentEdgeColor !== 'transparent' ? currentEdgeColor : undefined }}
                  >
                    {(!currentEdgeColor || currentEdgeColor === 'transparent') && (
                      <span className="flex items-center justify-center h-full text-[7px] text-muted-foreground">/</span>
                    )}
                  </span>
                  <span>Color</span>
                </button>

                {/* Edge width */}
                <button
                  onClick={() => setDefaultsPanel(defaultsPanel === 'edgeWidth' ? false : 'edgeWidth')}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors text-left"
                >
                  <span className="w-4 h-4 rounded border border-border flex items-center justify-center text-[9px] text-foreground shrink-0">
                    {currentEdgeWidth ?? '-'}
                  </span>
                  <span>Width</span>
                </button>

                {/* Reset */}
                {hasDefaults && (
                  <>
                    <div className="h-px bg-border my-1.5" />
                    <button
                      onClick={() => {
                        onDefaultsChange({ bgColor: undefined, borderColor: undefined, borderWidth: undefined, edgeColor: undefined, edgeWidth: undefined, edgeShape: undefined });
                        setDefaultsPanel(false);
                      }}
                      className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors text-muted-foreground"
                    >
                      <ArrowCounterClockwise size={14} />
                      <span>Reset defaults</span>
                    </button>
                  </>
                )}

                {/* Sub-panels */}
                {defaultsPanel === 'bg' && (
                  <div className="mt-1.5 pt-1.5 border-t border-border flex flex-wrap gap-1">
                    {NODE_COLORS.map((c) => (
                      <button
                        key={`dbg-${c}`}
                        onClick={() => { onDefaultsChange({ bgColor: c }); setDefaultsPanel(false); }}
                        className={cn(
                          'w-5 h-5 rounded border transition-transform',
                          c === currentBg ? 'border-foreground scale-110' : 'border-border'
                        )}
                        style={{ backgroundColor: c === 'transparent' ? undefined : c }}
                        title={c === 'transparent' ? 'No fill' : c}
                      >
                        {c === 'transparent' && (
                          <span className="flex items-center justify-center text-[8px] text-muted-foreground">/</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {defaultsPanel === 'border' && (
                  <div className="mt-1.5 pt-1.5 border-t border-border flex flex-wrap gap-1">
                    {NODE_COLORS.map((c) => (
                      <button
                        key={`dbd-${c}`}
                        onClick={() => { onDefaultsChange({ borderColor: c }); setDefaultsPanel(false); }}
                        className={cn(
                          'w-5 h-5 rounded border transition-transform',
                          c === currentBorder ? 'border-foreground scale-110' : 'border-border'
                        )}
                        style={{ backgroundColor: c === 'transparent' ? undefined : c }}
                        title={c === 'transparent' ? 'No border' : c}
                      >
                        {c === 'transparent' && (
                          <span className="flex items-center justify-center text-[8px] text-muted-foreground">/</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {defaultsPanel === 'width' && (
                  <div className="mt-1.5 pt-1.5 border-t border-border flex gap-1">
                    {BORDER_WIDTHS.map((w) => (
                      <button
                        key={`dw-${w}`}
                        onClick={() => { onDefaultsChange({ borderWidth: w }); setDefaultsPanel(false); }}
                        className={cn(
                          'w-6 h-6 rounded border flex items-center justify-center text-xs transition-colors',
                          w === currentWidth
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-foreground hover:bg-muted'
                        )}
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                )}

                {defaultsPanel === 'edgeShape' && (
                  <div className="mt-1.5 pt-1.5 border-t border-border flex gap-1">
                    {([
                      { value: 'default' as EdgeShape, label: 'Bezier', icon: BezierCurve },
                      { value: 'straight' as EdgeShape, label: 'Straight', icon: LineSegment },
                      { value: 'smoothstep' as EdgeShape, label: 'Smooth Step', icon: Path },
                      { value: 'step' as EdgeShape, label: 'Step', icon: ArrowBendRightDown },
                    ]).map(({ value, label, icon: Icon }) => (
                      <button
                        key={`des-${value}`}
                        onClick={() => { onDefaultsChange({ edgeShape: value }); setDefaultsPanel(false); }}
                        className={cn(
                          'p-1.5 rounded border transition-colors',
                          value === currentEdgeShape
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-foreground hover:bg-muted'
                        )}
                        title={label}
                      >
                        <Icon size={16} weight="duotone" />
                      </button>
                    ))}
                  </div>
                )}

                {defaultsPanel === 'edgeColor' && (
                  <div className="mt-1.5 pt-1.5 border-t border-border flex flex-wrap gap-1">
                    {NODE_COLORS.map((c) => (
                      <button
                        key={`dec-${c}`}
                        onClick={() => { onDefaultsChange({ edgeColor: c }); setDefaultsPanel(false); }}
                        className={cn(
                          'w-5 h-5 rounded border transition-transform',
                          c === currentEdgeColor ? 'border-foreground scale-110' : 'border-border'
                        )}
                        style={{ backgroundColor: c === 'transparent' ? undefined : c }}
                        title={c === 'transparent' ? 'Default' : c}
                      >
                        {c === 'transparent' && (
                          <span className="flex items-center justify-center text-[8px] text-muted-foreground">/</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {defaultsPanel === 'edgeWidth' && (
                  <div className="mt-1.5 pt-1.5 border-t border-border flex gap-1">
                    {BORDER_WIDTHS.map((w) => (
                      <button
                        key={`dew-${w}`}
                        onClick={() => { onDefaultsChange({ edgeWidth: w || undefined }); setDefaultsPanel(false); }}
                        className={cn(
                          'w-6 h-6 rounded border flex items-center justify-center text-xs transition-colors',
                          w === currentEdgeWidth
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-foreground hover:bg-muted'
                        )}
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Collaborator cursors popover - mirrors the Defaults menu pattern. */}
      {cursorsMode && onCursorsModeChange && (
        <>
          <div className="w-px h-5 bg-border" />
          <div className="relative">
            {(() => {
              const autoHidden =
                cursorsMode === 'auto' && peerCount > AUTO_CURSORS_HIDE_THRESHOLD;
              const effectiveOn =
                cursorsMode === 'on' || (cursorsMode === 'auto' && !autoHidden);
              const TriggerIcon = effectiveOn ? Cursor : CursorClick;
              return (
                <button
                  onClick={() => {
                    setShowCursorsMenu((v) => !v);
                    setShowShapeMenu(false);
                    setShowDefaultsMenu(false);
                  }}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md hover:bg-muted transition-colors',
                    effectiveOn ? 'text-foreground' : 'text-muted-foreground',
                    cursorsMode === 'on' && 'text-primary',
                  )}
                  title="Collaborator cursors"
                  aria-haspopup="menu"
                  aria-expanded={showCursorsMenu}
                >
                  <TriggerIcon size={16} weight="duotone" />
                  <span className="hidden sm:inline">Cursors</span>
                </button>
              );
            })()}

            {showCursorsMenu && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-card border border-border rounded-lg shadow-lg p-2 min-w-[220px]">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
                  Collaborator cursors
                </div>
                {CURSOR_MODE_OPTIONS.map(({ value, label, icon: Icon, description }) => {
                  const isSelected = cursorsMode === value;
                  return (
                    <button
                      key={value}
                      onClick={() => {
                        onCursorsModeChange(value);
                        setShowCursorsMenu(false);
                      }}
                      className={cn(
                        'flex items-center gap-2 w-full px-2 py-1.5 rounded text-left transition-colors',
                        'hover:bg-muted',
                        isSelected && 'bg-muted',
                      )}
                      role="menuitemradio"
                      aria-checked={isSelected}
                    >
                      <Icon
                        size={14}
                        weight="duotone"
                        className={isSelected ? 'text-primary' : 'text-muted-foreground'}
                      />
                      <span className="flex-1 min-w-0">
                        <span
                          className={cn(
                            'block text-xs font-medium',
                            isSelected ? 'text-foreground' : 'text-foreground',
                          )}
                        >
                          {label}
                        </span>
                        <span className="block text-[10px] text-muted-foreground truncate">
                          {description(peerCount)}
                        </span>
                      </span>
                      {isSelected && (
                        <Check size={14} weight="bold" className="text-primary shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
});
