import { AccessMode, ContentRole } from '@uniffy/proto/common/v1/common_pb';
import { LockSimple, Users, Buildings } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import {
    accessModeDescription,
    accessModeLabel,
} from '@/shared/utils/contentRoles';
import { ContentRoleSelect } from '@/features/permissions/components/ContentRoleSelect';

interface AccessModeValue {
    accessMode: AccessMode | number;
    baselineRole: ContentRole | number | null;
}

interface AccessModeSelectorProps {
    value: AccessModeValue;
    onChange: (value: AccessModeValue) => void;
    disabled?: boolean;
    defaultBaselineRole?: ContentRole;
}

const OPTIONS = [
    { mode: AccessMode.OWNER_ONLY, icon: LockSimple },
    { mode: AccessMode.EXPLICIT_MEMBERS, icon: Users },
    { mode: AccessMode.OPEN_TO_ORG, icon: Buildings },
];

export function AccessModeSelector({
    value,
    onChange,
    disabled,
    defaultBaselineRole = ContentRole.VIEWER,
}: AccessModeSelectorProps) {
    const handleModeChange = (mode: AccessMode) => {
        if (mode === AccessMode.OPEN_TO_ORG) {
            onChange({
                accessMode: mode,
                baselineRole: value.baselineRole ?? defaultBaselineRole,
            });
        } else {
            onChange({ accessMode: mode, baselineRole: null });
        }
    };

    return (
        <div className="space-y-2">
            {OPTIONS.map(({ mode, icon: Icon }) => {
                const selected = value.accessMode === mode;
                return (
                    <button
                        key={mode}
                        type="button"
                        onClick={() => handleModeChange(mode)}
                        disabled={disabled}
                        className={cn(
                            'w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors',
                            selected
                                ? 'border-primary bg-primary/5'
                                : 'border-border hover:bg-muted',
                            disabled && 'opacity-50 cursor-not-allowed',
                        )}
                    >
                        <div
                            className={cn(
                                'mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center',
                                selected ? 'border-primary' : 'border-muted-foreground',
                            )}
                        >
                            {selected && <div className="w-2 h-2 rounded-full bg-primary" />}
                        </div>
                        <Icon
                            size={20}
                            weight="duotone"
                            className={cn('shrink-0', selected ? 'text-primary' : 'text-muted-foreground')}
                        />
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground">
                                {accessModeLabel(mode)}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                                {accessModeDescription(mode)}
                            </div>
                        </div>
                    </button>
                );
            })}
            {value.accessMode === AccessMode.OPEN_TO_ORG && (
                <div className="ml-7 pl-3 border-l-2 border-primary/20 py-2 space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">
                        Baseline role for everyone in the organization
                    </label>
                    <ContentRoleSelect
                        value={value.baselineRole ?? ContentRole.VIEWER}
                        onChange={(role) =>
                            onChange({ accessMode: value.accessMode, baselineRole: role })
                        }
                        excludeRoles={[
                            ContentRole.OWNER,
                            ContentRole.BLOCKED,
                            ContentRole.UNSPECIFIED,
                        ]}
                        disabled={disabled}
                    />
                </div>
            )}
        </div>
    );
}
