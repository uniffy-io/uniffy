/**
 * Floating-label text input with optional leading icon. Shared by the
 * login form and the accept-invite form so both surfaces feel identical.
 */

import { useState } from 'react';
import { BRAND_ACCENT, BRAND_ACCENT_RING } from '@/features/auth/constants';

interface AuthInputProps {
    id: string;
    label: string;
    type?: string;
    value: string;
    onChange: (v: string) => void;
    required?: boolean;
    minLength?: number;
    icon?: React.ComponentType<{ className?: string }>;
    autoFocus?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
}

export function AuthInput({
    id,
    label,
    type = 'text',
    value,
    onChange,
    required,
    minLength,
    icon: Icon,
    autoFocus,
    disabled,
    readOnly,
}: AuthInputProps) {
    const [focused, setFocused] = useState(false);
    const isActive = focused || value.length > 0;

    return (
        <div className="group relative">
            {Icon && (
                <div
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 z-10 transition-colors duration-200"
                    style={focused ? { color: BRAND_ACCENT } : undefined}
                >
                    <Icon className={`h-4 w-4 ${!focused ? 'text-muted-foreground' : ''}`} />
                </div>
            )}

            <input
                id={id}
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                required={required}
                minLength={minLength}
                autoFocus={autoFocus}
                disabled={disabled}
                readOnly={readOnly}
                placeholder=""
                className={`
                    peer w-full rounded-lg border bg-background
                    transition-all duration-200 outline-none
                    text-foreground text-sm
                    ${Icon ? 'pl-10 pr-4' : 'px-4'}
                    pt-5 pb-2
                    ${disabled || readOnly ? 'bg-muted cursor-not-allowed' : ''}
                    ${!focused ? 'border-border hover:border-muted-foreground/40' : ''}
                `}
                style={focused ? {
                    borderColor: BRAND_ACCENT,
                    boxShadow: `0 0 0 2px ${BRAND_ACCENT_RING}, 0 1px 2px 0 rgba(0,0,0,0.05)`,
                } : undefined}
                data-testid={`auth-input-${id}`}
            />

            <label
                htmlFor={id}
                className={`
                    pointer-events-none absolute transition-all duration-200 select-none
                    ${Icon ? 'left-10' : 'left-4'}
                    ${isActive
                        ? 'top-1.5 text-[11px] font-medium tracking-wide uppercase'
                        : 'top-1/2 -translate-y-1/2 text-sm'
                    }
                    ${!focused ? 'text-muted-foreground' : ''}
                `}
                style={focused ? { color: BRAND_ACCENT } : undefined}
            >
                {label}
            </label>
        </div>
    );
}
