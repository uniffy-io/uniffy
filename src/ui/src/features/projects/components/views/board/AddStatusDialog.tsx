import { useState, useRef, useEffect } from "react";
import { X } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";

const STATUS_COLORS = [
  "#6b7280",
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#14b8a6",
];

interface AddStatusDialogProps {
  onSubmit: (label: string, color: string) => void;
  onClose: () => void;
}

export function AddStatusDialog({ onSubmit, onClose }: AddStatusDialogProps) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(STATUS_COLORS[0]);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const handleSubmit = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    onSubmit(trimmed, color);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && label.trim()) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div
      ref={containerRef}
      className="w-64 rounded-lg border border-border bg-card shadow-xl p-4"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-foreground">New Status</span>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>

      <input
        ref={inputRef}
        type="text"
        placeholder="Status name"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full h-8 px-2 mb-3 text-sm bg-background border border-border rounded outline-none text-foreground focus:border-primary"
      />

      <div className="mb-3">
        <span className="text-xs text-muted-foreground mb-1.5 block">Color</span>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={cn(
                "w-6 h-6 rounded-full transition-all",
                color === c
                  ? "ring-2 ring-offset-2 ring-offset-card ring-primary scale-110"
                  : "hover:scale-110",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <div className="mb-3">
        <span className="text-xs text-muted-foreground mb-1 block">Preview</span>
        <div
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium"
          style={{
            backgroundColor: `${color}15`,
            border: `1px solid ${color}30`,
            color,
          }}
        >
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          {label.trim() || "Status name"}
        </div>
      </div>

      <Button size="sm" className="w-full h-8" disabled={!label.trim()} onClick={handleSubmit}>
        Add Status
      </Button>
    </div>
  );
}
