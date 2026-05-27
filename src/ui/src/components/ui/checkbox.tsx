import { forwardRef, useId } from 'react';
import { Check } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, description, id, checked, ...props }, ref) => {
    const generatedId = useId();
    const checkboxId = id || generatedId;

    return (
      <div className={cn('flex items-start gap-3', className)}>
        <div className="relative flex items-center">
          <input
            ref={ref}
            type="checkbox"
            id={checkboxId}
            checked={checked}
            className="peer sr-only"
            {...props}
          />
          <div
            className={cn(
              'h-5 w-5 rounded border-2 transition-all duration-150 cursor-pointer',
              'flex items-center justify-center',
              'border-border bg-background',
              'peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
              'peer-checked:border-primary peer-checked:bg-primary',
              'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
              'hover:border-primary/70'
            )}
            onClick={() => {
              const input = document.getElementById(checkboxId) as HTMLInputElement;
              if (input && !input.disabled) {
                input.click();
              }
            }}
          >
            <Check
              size={14}
              weight="bold"
              className={cn(
                'text-primary-foreground transition-opacity duration-150',
                checked ? 'opacity-100' : 'opacity-0'
              )}
            />
          </div>
        </div>
        {(label || description) && (
          <div className="flex flex-col">
            {label && (
              <label
                htmlFor={checkboxId}
                className="text-sm font-medium text-foreground cursor-pointer select-none"
              >
                {label}
              </label>
            )}
            {description && (
              <span className="text-xs text-muted-foreground">{description}</span>
            )}
          </div>
        )}
      </div>
    );
  }
);

Checkbox.displayName = 'Checkbox';

