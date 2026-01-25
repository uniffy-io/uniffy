/**
 * Permission Level Select Component
 *
 * Dropdown for selecting permission level (View, Edit, Admin).
 */

import { Select, type SelectOption } from '@/components/ui/select';
import { PermissionLevel } from '@/gen/common/v1/common_pb';

const PERMISSION_OPTIONS: SelectOption<number>[] = [
    { value: PermissionLevel.VIEW, label: 'Can view' },
    { value: PermissionLevel.EDIT, label: 'Can edit' },
    { value: PermissionLevel.ADMIN, label: 'Admin' },
];

interface PermissionLevelSelectProps {
    value: number;
    onChange: (level: number) => void;
    disabled?: boolean;
    compact?: boolean;
}

export function PermissionLevelSelect({
    value,
    onChange,
    disabled = false,
    compact = false,
}: PermissionLevelSelectProps) {
    return (
        <Select
            value={value}
            onChange={onChange}
            options={PERMISSION_OPTIONS}
            disabled={disabled}
            size={compact ? 'sm' : 'md'}
        />
    );
}

export default PermissionLevelSelect;
