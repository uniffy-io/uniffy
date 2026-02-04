/**
 * Share Button Component
 *
 * Trigger button to open the sharing dialog.
 */

import { ShareNetwork } from '@phosphor-icons/react';
import { useSharingDialog } from '@/features/sharing/hooks/useSharingHooks';
import { ContentType } from '@/gen/common/v1/common_pb';

interface ShareButtonProps {
    contentType: ContentType;
    contentId: string;
    contentTitle: string;
    className?: string;
    iconOnly?: boolean;
}

export function ShareButton({
    contentType,
    contentId,
    contentTitle,
    className = '',
    iconOnly = false,
}: ShareButtonProps) {
    const { open } = useSharingDialog();

    const handleClick = () => {
        open(contentType, contentId, contentTitle);
    };

    if (iconOnly) {
        return (
            <button
                type="button"
                onClick={handleClick}
                className={`p-2 rounded-md bg-transparent hover:bg-muted transition-colors ${className}`}
                title="Share"
            >
                <ShareNetwork size={20} weight="duotone" className="text-primary" />
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={handleClick}
            className={`
                flex items-center gap-2 px-3 py-2 rounded-md
                bg-primary text-primary-foreground
                hover:bg-primary/90 transition-colors
                text-sm font-medium
                ${className}
            `}
        >
            <ShareNetwork size={16} />
            <span>Share</span>
        </button>
    );
}

