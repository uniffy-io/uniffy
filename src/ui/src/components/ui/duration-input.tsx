import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/shared/utils/cn";
import { formatMinutes, parseTimeInput } from "@/shared/utils/durationFormatting";

interface DurationInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
> {
  minutes: number | null;
  /** Called on blur or Enter with the parsed value; null clears. Invalid text is not committed. */
  onChange: (minutes: number | null) => void;
  /** Called on Escape; the text reverts to `minutes`. */
  onCancel?: () => void;
}

/**
 * Text field for a duration ("2h 30m", "1.5h", "45"). Shows the formatted value while
 * idle and the raw text while focused, so a background refresh never overwrites typing.
 */
export const DurationInput = React.forwardRef<HTMLInputElement, DurationInputProps>(
  function DurationInput(
    { minutes, onChange, onCancel, className, placeholder = "e.g. 2h 30m", ...rest },
    ref,
  ) {
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState("");
    const idle = minutes ? formatMinutes(minutes) : "";
    const trimmed = text.trim();
    const invalid = editing && trimmed.length > 0 && parseTimeInput(trimmed) === null;

    const commit = () => {
      setEditing(false);
      if (!trimmed) {
        onChange(null);
        return;
      }
      const parsed = parseTimeInput(trimmed);
      if (parsed !== null) onChange(parsed);
    };

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="text"
        value={editing ? text : idle}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        className={cn(invalid && "border-red-500 focus:border-red-500", className)}
        onFocus={(event) => {
          setText(idle);
          setEditing(true);
          rest.onFocus?.(event);
        }}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => {
          commit();
          rest.onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
            onCancel?.();
            event.currentTarget.blur();
          }
          rest.onKeyDown?.(event);
        }}
        {...rest}
      />
    );
  },
);
