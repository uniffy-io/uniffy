/** Fixed-height typing indicator (always mounted to prevent layout shift). */

import { cn } from '@/shared/utils/cn';
import { useAppSelector } from '@/app/hooks';
import { SubjectAvatarById } from '@/components/subject';
import { AgentAvatar } from '@/features/agents/components/AgentAvatar';

interface TypingEntry {
  userId: string;
  displayName: string;
  isAgent?: boolean;
}

interface TypingIndicatorProps {
  typingUsers: TypingEntry[];
}

function buildTypingText(users: { displayName: string }[]): string {
  if (users.length === 0) return '';
  if (users.length === 1) return `${users[0].displayName} is typing`;
  if (users.length === 2) return `${users[0].displayName} and ${users[1].displayName} are typing`;
  return 'Several people are typing';
}

function TypingAvatar({ entry }: { entry: TypingEntry }) {
  const agent = useAppSelector((state) =>
    entry.isAgent ? state.agents.agents[entry.userId] ?? null : null,
  );
  if (entry.isAgent) {
    return (
      <AgentAvatar
        avatarKey={agent?.avatarKey}
        avatarEmoji={agent?.avatarEmoji}
        agentName={agent?.name ?? entry.displayName}
        size="xs"
      />
    );
  }
  return <SubjectAvatarById userId={entry.userId} displayName={entry.displayName} size="xs" />;
}

export function TypingIndicator({ typingUsers }: TypingIndicatorProps) {
  if (typingUsers.length === 0) {
    return <div className="h-6" />;
  }

  const typingText = buildTypingText(typingUsers);
  const visible = typingUsers.slice(0, 3);

  return (
    <div className="h-6 flex items-center gap-2 px-4 text-xs text-muted-foreground transition-opacity duration-150">
      <div className="flex items-center -space-x-1">
        {visible.map((u) => (
          <div key={u.userId} className="border border-background rounded-full">
            <TypingAvatar entry={u} />
          </div>
        ))}
      </div>

      <span className="flex items-center gap-0.5">
        <span>{typingText}</span>
        <span className="flex items-center gap-[2px] ml-0.5">
          <span
            className={cn(
              'inline-block w-1 h-1 rounded-full bg-muted-foreground',
              'animate-bounce',
            )}
            style={{ animationDelay: '0s', animationDuration: '1s' }}
          />
          <span
            className={cn(
              'inline-block w-1 h-1 rounded-full bg-muted-foreground',
              'animate-bounce',
            )}
            style={{ animationDelay: '0.2s', animationDuration: '1s' }}
          />
          <span
            className={cn(
              'inline-block w-1 h-1 rounded-full bg-muted-foreground',
              'animate-bounce',
            )}
            style={{ animationDelay: '0.4s', animationDuration: '1s' }}
          />
        </span>
      </span>
    </div>
  );
}
