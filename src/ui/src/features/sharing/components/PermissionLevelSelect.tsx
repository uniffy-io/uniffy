/**
 * Permission Level Select Component
 *
 * Dropdown for selecting permission level (View, Edit, Admin).
 * Supports filtering available levels via allowedLevels prop.
 */

import { useMemo } from 'react';
import { Select, type SelectOption } from '@/components/ui/select';
import { PermissionLevel } from '@uniffy/proto/common/v1/common_pb';

const ALL_PERMISSION_OPTIONS: SelectOption<number>[] = [
    { value: PermissionLevel.VIEW, label: 'Can view' },
    { value: PermissionLevel.EDIT, label: 'Can edit' },
    { value: PermissionLevel.ADMIN, label: 'Admin' },
];

interface PermissionLevelSelectProps {
    value: number;
    onChange: (level: number) => void;
    disabled?: boolean;
    compact?: boolean;
    allowedLevels?: number[];
}

export function PermissionLevelSelect({
    value,
    onChange,
    disabled = false,
    compact = false,
    allowedLevels,
}: PermissionLevelSelectProps) {
    const options = useMemo(
        () =>
            allowedLevels
                ? ALL_PERMISSION_OPTIONS.filter((o) => allowedLevels.includes(o.value))
                : ALL_PERMISSION_OPTIONS,
        [allowedLevels],
    );

    return (
        <Select
            value={value}
            onChange={onChange}
            options={options}
            disabled={disabled}
            size={compact ? 'sm' : 'md'}
        />
    );
}

