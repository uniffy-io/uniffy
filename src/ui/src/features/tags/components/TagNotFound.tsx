import { Link } from 'react-router-dom';
import { Tag as TagIcon, ArrowRight } from '@phosphor-icons/react';

interface TagNotFoundProps {
    slug?: string;
}

export function TagNotFound({ slug }: TagNotFoundProps) {
    return (
        <div className="flex h-full flex-1 flex-col items-center justify-center px-6 py-12 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-muted">
                <TagIcon
                    size={28}
                    weight="duotone"
                    className="text-muted-foreground"
                />
            </div>
            <h2 className="mt-6 text-xl font-semibold text-foreground">
                Tag not found
            </h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {slug ? (
                    <>
                        No tag named <code className="rounded bg-muted px-1.5 py-0.5 text-xs">#{slug}</code>{' '}
                        exists in this organization. It may have been renamed,
                        merged, or deleted.
                    </>
                ) : (
                    'The tag you are looking for does not exist in this organization.'
                )}
            </p>
            <Link
                to="/tags"
                className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
                View all tags
                <ArrowRight size={14} weight="bold" />
            </Link>
        </div>
    );
}
