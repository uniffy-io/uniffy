import { Hash, Lock } from '@phosphor-icons/react';

import { type ChannelType } from '@/features/chat/mock/types';

interface ChannelEmptyStateProps {
  channelName: string;
  channelType: ChannelType;
  description?: string;
}

export function ChannelEmptyState({
  channelName,
  channelType,
  description,
}: ChannelEmptyStateProps) {
  const isPrivate = channelType === 'PRIVATE';
  const Icon = isPrivate ? Lock : Hash;

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="flex flex-col items-center text-center max-w-md">
        <Icon size={48} weight="light" className="text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-semibold text-foreground">
          This is the start of #{channelName}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {description || 'Start connecting with your team.'}
        </p>
      </div>
    </div>
  );
}
