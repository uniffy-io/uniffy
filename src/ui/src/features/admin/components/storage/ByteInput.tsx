import { useState, useCallback, useMemo } from "react";
import { cn } from "@/shared/utils/cn";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type ByteUnit = "MB" | "GB" | "TB";

const UNIT_MULTIPLIERS: Record<ByteUnit, number> = {
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
  TB: 1024 * 1024 * 1024 * 1024,
};

const UNIT_OPTIONS = [
  { value: "MB" as const, label: "MB" },
  { value: "GB" as const, label: "GB" },
  { value: "TB" as const, label: "TB" },
];

interface ByteInputProps {
  value: number | null;
  onChange: (bytes: number | null) => void;
  label?: string;
  allowUnlimited?: boolean;
  className?: string;
  disabled?: boolean;
}

function bytesToUnit(bytes: number): { value: number; unit: ByteUnit } {
  if (bytes >= UNIT_MULTIPLIERS.TB) {
    return { value: bytes / UNIT_MULTIPLIERS.TB, unit: "TB" };
  }
  if (bytes >= UNIT_MULTIPLIERS.GB) {
    return { value: bytes / UNIT_MULTIPLIERS.GB, unit: "GB" };
  }
  return { value: bytes / UNIT_MULTIPLIERS.MB, unit: "MB" };
}

export function ByteInput({
  value,
  onChange,
  label,
  allowUnlimited = true,
  className,
  disabled = false,
}: ByteInputProps) {
  const isUnlimited = value === null;

  const initial = useMemo(() => {
    if (value === null || value === 0) return { displayValue: "", unit: "GB" as ByteUnit };
    const converted = bytesToUnit(value);
    return { displayValue: String(converted.value), unit: converted.unit };
  }, [value]);

  const [displayValue, setDisplayValue] = useState(initial.displayValue);
  const [unit, setUnit] = useState<ByteUnit>(initial.unit);

  const handleValueChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
      setDisplayValue(raw);
      const num = parseFloat(raw);
      if (!isNaN(num) && num >= 0) {
        onChange(Math.round(num * UNIT_MULTIPLIERS[unit]));
      }
    },
    [unit, onChange],
  );

  const handleUnitChange = useCallback(
    (newUnit: string) => {
      const typedUnit = newUnit as ByteUnit;
      setUnit(typedUnit);
      const num = parseFloat(displayValue);
      if (!isNaN(num) && num >= 0) {
        onChange(Math.round(num * UNIT_MULTIPLIERS[typedUnit]));
      }
    },
    [displayValue, onChange],
  );

  const handleUnlimitedToggle = useCallback(() => {
    if (isUnlimited) {
      const num = parseFloat(displayValue);
      if (!isNaN(num) && num >= 0) {
        onChange(Math.round(num * UNIT_MULTIPLIERS[unit]));
      } else {
        setDisplayValue("10");
        onChange(10 * UNIT_MULTIPLIERS.GB);
      }
    } else {
      onChange(null);
    }
  }, [isUnlimited, displayValue, unit, onChange]);

  return (
    <div className={cn("space-y-2", className)}>
      {label && <label className="text-sm font-medium text-foreground">{label}</label>}
      <div className="flex items-center gap-2">
        <Input
          type="text"
          inputMode="decimal"
          value={isUnlimited ? "" : displayValue}
          onChange={handleValueChange}
          disabled={disabled || isUnlimited}
          placeholder={isUnlimited ? "Unlimited" : "0"}
          className="flex-1"
        />
        <Select
          value={unit}
          onChange={handleUnitChange}
          options={UNIT_OPTIONS}
          disabled={disabled || isUnlimited}
          size="md"
        />
      </div>
      {allowUnlimited && (
        <Checkbox
          label="Unlimited"
          checked={isUnlimited}
          onChange={handleUnlimitedToggle}
          disabled={disabled}
        />
      )}
    </div>
  );
}
