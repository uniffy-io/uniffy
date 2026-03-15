/**
 * Sharing Dialog Component
 *
 * Modal for managing content permissions - add users/groups, change levels, remove access.
 */

import { Fragment, useMemo, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
    X,
    ShareNetwork,
    User,
    ShieldCheck,
    WarningCircle,
} from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { ContentType, PermissionLevel } from '@/gen/common/v1/common_pb';
import {
    useSharingDialog,
    useContentPermissions,
    sortPermissions,
} from '@/features/sharing/hooks/useSharingHooks';
import { ShareTargetSearch } from '@/features/sharing/components/ShareTargetSearch';
import { PermissionRow } from '@/features/sharing/components/PermissionRow';
import type { SerializedShareTarget } from '@/features/sharing/store/sharingSlice';
import { getInitials } from '@/components/subject/utils';

const AGENT_LEVELS = [PermissionLevel.VIEW, PermissionLevel.ADMIN];

export function SharingDialog() {
    const { isOpen, activeContent, close } = useSharingDialog();
    const currentUser = useAppSelector((state) => state.auth.user);

    // Only call hooks when we have content
    const contentType = activeContent?.contentType ?? 0;
    const contentId = activeContent?.contentId ?? '';

    const {
        permissions,
        owner,
        loading,
        error,
        grant,
        revoke,
        update,
    } = useContentPermissions(contentType, contentId);

    const [granting, setGranting] = useState(false);
    const [grantError, setGrantError] = useState<string | null>(null);

    // Sort permissions for display
    const sortedPermissions = useMemo(() => sortPermissions(permissions), [permissions]);

    // Get list of already-shared subject IDs
    const existingSubjectIds = useMemo(
        () => permissions.map((p) => p.subject?.id).filter(Boolean) as string[],
        [permissions]
    );

    // Check if current user is the owner
    const isOwner = currentUser && owner && owner.id === currentUser.id;

    // Agents and provider keys only support VIEW and ADMIN (no separate EDIT level)
    const allowedLevels =
        contentType === ContentType.AGENT || contentType === ContentType.PROVIDER_KEY
            ? AGENT_LEVELS
            : undefined;

    // Handle granting permission
    const handleGrant = async (target: SerializedShareTarget, level: number) => {
        setGranting(true);
        setGrantError(null);
        try {
            await grant(target.type, target.id, level);
        } catch (err) {
            setGrantError(err instanceof Error ? err.message : 'Failed to grant permission');
        } finally {
            setGranting(false);
        }
    };

    // Handle updating permission
    const handleUpdate = async (permissionId: string, level: number) => {
        await update(permissionId, level);
    };

    // Handle removing permission
    const handleRemove = async (permissionId: string) => {
        await revoke(permissionId);
    };

    if (!activeContent) {
        return null;
    }

    return (
        <Transition appear show={isOpen} as={Fragment}>
            <Dialog as="div" className="relative z-50" onClose={close}>
                {/* Backdrop */}
                <Transition.Child
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div className="fixed inset-0 bg-black/50" />
                </Transition.Child>

                {/* Dialog */}
                <div className="fixed inset-0 overflow-y-auto">
                    <div className="flex min-h-full items-center justify-center p-4">
                        <Transition.Child
                            as={Fragment}
                            enter="ease-out duration-300"
                            enterFrom="opacity-0 scale-95"
                            enterTo="opacity-100 scale-100"
                            leave="ease-in duration-200"
                            leaveFrom="opacity-100 scale-100"
                            leaveTo="opacity-0 scale-95"
                        >
                            <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-xl bg-card border border-border shadow-xl transition-all">
                                {/* Header */}
                                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-primary/10">
                                            <ShareNetwork size={20} weight="duotone" className="text-primary" />
                                        </div>
                                        <div>
                                            <Dialog.Title className="text-lg font-semibold">
                                                Share
                                            </Dialog.Title>
                                            <p className="text-sm text-muted-foreground truncate max-w-[280px]">
                                                {activeContent.title}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={close}
                                        className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                    >
                                        <X size={20} weight="bold" />
                                    </button>
                                </div>

                                {/* Content */}
                                <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
                                    {/* Search */}
                                    <div className="mb-6">
                                        <label className="block text-sm font-medium mb-2">
                                            Add people or groups
                                        </label>
                                        <ShareTargetSearch
                                            onSelect={handleGrant}
                                            existingSubjectIds={existingSubjectIds}
                                            disabled={granting}
                                            allowedLevels={allowedLevels}
                                        />
                                        {grantError && (
                                            <div className="mt-2 flex items-center gap-2 text-sm" style={{ color: 'var(--status-error)' }}>
                                                <WarningCircle size={16} weight="fill" />
                                                {grantError}
                                            </div>
                                        )}
                                    </div>

                                    {/* Error state */}
                                    {error && (
                                        <div className="mb-4 p-3 rounded-lg border status-error">
                                            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--status-error)' }}>
                                                <WarningCircle size={16} weight="fill" />
                                                {error}
                                            </div>
                                        </div>
                                    )}

                                    {/* Loading state */}
                                    {loading ? (
                                        <div className="py-8 text-center">
                                            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                                            <p className="text-sm text-muted-foreground">
                                                Loading permissions...
                                            </p>
                                        </div>
                                    ) : (
                                        <>
                                            {/* Owner section */}
                                            {owner && (
                                                <div className="mb-4">
                                                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                                                        Owner
                                                    </h3>
                                                    <div className="flex items-center gap-3 py-3 px-3 rounded-lg bg-muted/30">
                                                        <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                                                            {owner.avatarUrl ? (
                                                                <img
                                                                    src={owner.avatarUrl}
                                                                    alt={owner.name}
                                                                    className="w-full h-full rounded-full object-cover"
                                                                />
                                                            ) : (
                                                                <span className="text-xs font-medium text-primary-foreground">
                                                                    {getInitials(owner.name)}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <p className="text-sm font-medium truncate">
                                                                    {owner.name}
                                                                </p>
                                                                {isOwner && (
                                                                    <span className="text-xs text-muted-foreground">
                                                                        (you)
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {owner.email && (
                                                                <p className="text-xs text-muted-foreground truncate">
                                                                    {owner.email}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                                            <ShieldCheck size={16} weight="fill" />
                                                            <span>Owner</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Shared with section */}
                                            <div>
                                                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                                                    Shared with
                                                    {sortedPermissions.length > 0 && (
                                                        <span className="ml-2 text-muted-foreground font-normal">
                                                            ({sortedPermissions.length})
                                                        </span>
                                                    )}
                                                </h3>

                                                {sortedPermissions.length === 0 ? (
                                                    <div className="py-6 text-center border border-dashed border-border rounded-lg">
                                                        <User size={32} weight="duotone" className="mx-auto text-muted-foreground/50 mb-2" />
                                                        <p className="text-sm text-muted-foreground">
                                                            Not shared with anyone yet
                                                        </p>
                                                        <p className="text-xs text-muted-foreground mt-1">
                                                            Search above to add people or groups
                                                        </p>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-1">
                                                        {sortedPermissions.map((permission) => (
                                                            <PermissionRow
                                                                key={permission.id}
                                                                permission={permission}
                                                                onUpdate={handleUpdate}
                                                                onRemove={handleRemove}
                                                                canEdit={isOwner ?? false}
                                                                allowedLevels={allowedLevels}
                                                            />
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>

                                {/* Footer */}
                                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-muted/30">
                                    <button
                                        type="button"
                                        onClick={close}
                                        className="px-4 py-2 rounded-md text-sm font-medium
                                            bg-primary text-primary-foreground
                                            hover:bg-primary/90 transition-colors"
                                    >
                                        Done
                                    </button>
                                </div>
                            </Dialog.Panel>
                        </Transition.Child>
                    </div>
                </div>
            </Dialog>
        </Transition>
    );
}

