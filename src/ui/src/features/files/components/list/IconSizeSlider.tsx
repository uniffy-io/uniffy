/**
 * Icon Size Slider Component
 *
 * A slider control for adjusting grid icon sizes, similar to macOS Finder.
 */

import { useCallback } from 'react';
import { SquaresFour } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';

interface IconSizeSliderProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    disabled?: boolean;
}

const SIZE_LABELS = ['Small', 'Medium', 'Large', 'Extra Large'];

export function IconSizeSlider({
    value,
    onChange,
    min = 0,
    max = 3,
    disabled = false,
}: IconSizeSliderProps) {
    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            onChange(Number(e.target.value));
        },
        [onChange]
    );

    return (
        <div className="flex items-center gap-2">
            {/* Small icon indicator */}
            <SquaresFour
                size={12}
                className={cn(
                    'text-muted-foreground transition-colors',
                    value === min && 'text-primary'
                )}
            />

            {/* Slider */}
            <input
                type="range"
                min={min}
                max={max}
                step={1}
                value={value}
                onChange={handleChange}
                disabled={disabled}
                className={cn(
                    'w-20 h-1 appearance-none rounded-full cursor-pointer',
                    'bg-muted',
                    '[&::-webkit-slider-thumb]:appearance-none',
                    '[&::-webkit-slider-thumb]:w-3',
                    '[&::-webkit-slider-thumb]:h-3',
                    '[&::-webkit-slider-thumb]:rounded-full',
                    '[&::-webkit-slider-thumb]:bg-primary',
                    '[&::-webkit-slider-thumb]:cursor-pointer',
                    '[&::-webkit-slider-thumb]:transition-transform',
                    '[&::-webkit-slider-thumb]:hover:scale-110',
                    '[&::-moz-range-thumb]:w-3',
                    '[&::-moz-range-thumb]:h-3',
                    '[&::-moz-range-thumb]:rounded-full',
                    '[&::-moz-range-thumb]:bg-primary',
                    '[&::-moz-range-thumb]:border-0',
                    '[&::-moz-range-thumb]:cursor-pointer',
                    disabled && 'opacity-50 cursor-not-allowed'
                )}
                title={SIZE_LABELS[value] || ''}
            />

            {/* Large icon indicator */}
            <SquaresFour
                size={18}
                className={cn(
                    'text-muted-foreground transition-colors',
                    value === max && 'text-primary'
                )}
            />
        </div>
    );
}
