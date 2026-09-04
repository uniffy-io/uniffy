import { useState, useRef, useEffect } from "react";
import { X } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { popoverShellClass } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AddStatusDialogProps {
  onSubmit: (label: string) => void;
  onClose: () => void;
}

// Colour comes from the status's slot on the brand axis; overrides live in project settings.
export function AddStatusDialog({ onSubmit, onClose }: AddStatusDialogProps) {
  const [label, setLabel] = useState("");
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
    onSubmit(trimmed);
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
      className={cn(popoverShellClass, "w-64 p-4")}
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

      <Input
        ref={inputRef}
        type="text"
        placeholder="Status name"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={handleKeyDown}
        className="h-8 mb-3 px-2"
      />

      <Button size="sm" className="w-full h-8" disabled={!label.trim()} onClick={handleSubmit}>
        Add Status
      </Button>
    </div>
  );
}
