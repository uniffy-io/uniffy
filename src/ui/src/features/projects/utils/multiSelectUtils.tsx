import { MultiSelect } from "@/components/ui/multi-select";
import type { SelectOption } from "@/features/projects/types";


interface MultiSelectFieldProps {
  options: SelectOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
}

/** Adapts project `SelectOption` (id/label/color) to the shared MultiSelect (value/label). */
export function MultiSelectField({
  options,
  value,
  onChange,
  disabled = false,
  placeholder = "Select...",
  className,
  size = "md",
}: MultiSelectFieldProps) {
  const selectOptions = options.map((opt) => ({
    value: opt.id,
    label: opt.label,
  }));

  return (
    <MultiSelect
      value={value}
      onChange={onChange}
      options={selectOptions}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      size={size}
    />
  );
}
