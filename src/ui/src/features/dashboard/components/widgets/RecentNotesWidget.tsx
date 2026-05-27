import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { NotePencil, ArrowRight } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { WidgetCard, EmptyWidget, WidgetSkeleton } from '@/features/dashboard/components/widgets/WidgetCard';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';

function timestampToIso(ts: { seconds: number; nanos: number } | undefined): string {
  if (!ts) return new Date(0).toISOString();
  return new Date(ts.seconds * 1000).toISOString();
}

export function RecentNotesWidget() {
  const navigate = useNavigate();
  const notes = useAppSelector((state) => state.notes?.notes ?? {});
  const isLoading = useAppSelector((state) => state.notes?.loading ?? false);

  const recentNotes = useMemo(() => {
    return Object.values(notes)
      .filter((n) => !n.isDeleted)
      .sort((a, b) => {
        const aTime = a.updatedAt?.seconds ?? 0;
        const bTime = b.updatedAt?.seconds ?? 0;
        return bTime - aTime;
      })
      .slice(0, 5);
  }, [notes]);

  const isEmpty = recentNotes.length === 0 && !isLoading;

  return (
    <WidgetCard
      title="Recent Notes"
      icon={NotePencil}
      colSpan={2}
      priority={2}
      footer={
        recentNotes.length > 0 ? (
          <Link
            to="/notes"
            className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            View all notes
            <ArrowRight size={12} />
          </Link>
        ) : null
      }
    >
      {isLoading && Object.keys(notes).length === 0 ? (
        <WidgetSkeleton rows={4} />
      ) : isEmpty ? (
        <EmptyWidget
          icon={NotePencil}
          title="No notes yet"
          description="Start writing! Your recent notes will appear here"
          action={{
            label: 'Create a note',
            onClick: () => navigate('/notes?new=true'),
          }}
        />
      ) : (
        <div className="space-y-0.5">
          {recentNotes.map((note) => (
            <Link
              key={note.id}
              to={`/notes/${note.id}`}
              className={cn(
                'group flex items-center gap-3 rounded-lg p-2 -mx-2 transition-colors',
                'hover:bg-muted/50',
              )}
            >
              <div className="rounded-md p-1.5 bg-primary/10">
                <NotePencil size={16} weight="duotone" className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                  {note.title || 'Untitled'}
                </p>
              </div>
              <span className="text-xs text-muted-foreground flex-shrink-0">
                {formatRelativeTime(timestampToIso(note.updatedAt))}
              </span>
            </Link>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
