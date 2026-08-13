import * as React from "react";
import { cn } from "@/shared/utils/cn";
import { Input, type InputProps } from "@/components/ui/input";

export type NumberInputProps = Omit<InputProps, "type">;

/** Numeric input without the native spin buttons. */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ className, ...props }, ref) => (
    <Input
      ref={ref}
      type="number"
      inputMode="decimal"
      className={cn(
        "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        className
      )}
      {...props}
    />
  )
);

NumberInput.displayName = "NumberInput";
