import { useRef, useCallback } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { cn } from "@/shared/utils/cn";

interface NotificationSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function NotificationSearch({
  value,
  onChange,
  placeholder = "Search notifications...",
  className,
}: NotificationSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = useCallback(() => {
    onChange("");
    inputRef.current?.focus();
  }, [onChange]);

  return (
    <div className={cn("relative", className)}>
      <MagnifyingGlass
        size={14}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle-foreground"
      />
      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 pl-8 pr-8 text-xs"
      />
      {value && (
        <button
          onClick={handleClear}
          className={cn(
            "absolute right-2 top-1/2 -translate-y-1/2",
            "p-0.5 rounded text-subtle-foreground",
            "hover:text-foreground transition-colors",
          )}
        >
          <X size={12} weight="bold" />
        </button>
      )}
    </div>
  );
}
