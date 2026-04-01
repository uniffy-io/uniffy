/**
 * TypingIndicator - Shows who is currently typing in the channel.
 *
 * Renders a fixed-height container (always present to prevent layout shift)
 * with avatars, animated dots, and user names when people are typing.
 */

import { cn } from '@/shared/utils/cn';
import { SubjectAvatarById } from '@/components/subject';

interface TypingIndicatorProps {
  typingUsers: { userId: string; displayName: string }[];
}

function buildTypingText(users: { displayName: string }[]): string {
  if (users.length === 0) return '';
  if (users.length === 1) return `${users[0].displayName} is typing`;
  if (users.length === 2) return `${users[0].displayName} and ${users[1].displayName} are typing`;
  return 'Several people are typing';
}

export function TypingIndicator({ typingUsers }: TypingIndicatorProps) {
  if (typingUsers.length === 0) {
    return <div className="h-6" />;
  }

  const typingText = buildTypingText(typingUsers);
  const visible = typingUsers.slice(0, 3);

  return (
    <div className="h-6 flex items-center gap-2 px-4 text-xs text-muted-foreground transition-opacity duration-150">
      {/* Avatars */}
      <div className="flex items-center -space-x-1">
        {visible.map((u) => (
          <div key={u.userId} className="border border-background rounded-full">
            <SubjectAvatarById userId={u.userId} displayName={u.displayName} size="xs" />
          </div>
        ))}
      </div>

      {/* Typing text with animated dots */}
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
