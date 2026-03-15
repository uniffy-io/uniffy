import { Brain } from '@phosphor-icons/react';
import { EmptyState } from '@/components/feedback/EmptyState';

interface AgentsEmptyStateProps {
  onNewChat?: () => void;
}

export function AgentsEmptyState({ onNewChat }: AgentsEmptyStateProps) {
  return (
    <EmptyState
      icon={Brain}
      title="Start a conversation"
      description="Chat with AI agents that can search your workspace, create notes, manage tasks, and more. Select an agent to begin."
      actionLabel={onNewChat ? 'New Chat' : undefined}
      onAction={onNewChat}
    />
  );
}
