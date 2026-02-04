import React from 'react';
import { cn } from '@/shared/utils/cn';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'sm', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          // Base styles - sleeker, modern design
          'inline-flex items-center justify-center gap-2 rounded-lg font-medium',
          'transition-all duration-200 ease-in-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:pointer-events-none disabled:opacity-50',
          'active:scale-[0.98]',
          'cursor-pointer',
          // Variant styles
          {
            // Default - Primary action button with gradient (uses accent color via CSS variable)
            'bg-primary text-primary-foreground shadow-sm': 
              variant === 'default',
            'hover:bg-primary/90 hover:shadow-md': 
              variant === 'default',
            
            // Secondary - Muted alternative
            'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-secondary': 
              variant === 'secondary',
            
            // Outline - Clean border style
            'border border-input bg-transparent hover:bg-accent hover:text-accent-foreground': 
              variant === 'outline',
            
            // Ghost - Minimal, text-only style
            'hover:bg-accent/50 hover:text-accent-foreground': 
              variant === 'ghost',
            
            // Destructive - Danger actions
            'bg-gradient-to-b from-red-500 to-red-600 text-white shadow-sm shadow-red-500/25': 
              variant === 'destructive',
            'hover:from-red-600 hover:to-red-700 hover:shadow-md hover:shadow-red-500/30': 
              variant === 'destructive',
          },
          // Size styles - more compact and modern
          {
            'h-7 px-2.5 text-xs': size === 'xs',
            'h-8 px-3 text-sm': size === 'sm',
            'h-9 px-4 text-sm': size === 'md',
            'h-10 px-6 text-base': size === 'lg',
            'h-8 w-8 p-0': size === 'icon',
          },
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
