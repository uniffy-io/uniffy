/**
 * Table Component
 *
 * A styled table with header, body, row, and cell components.
 * Includes loading and empty state helpers.
 */

import { forwardRef } from 'react';
import { cn } from '@/utils/cn';

// ============================================================================
// Table Root
// ============================================================================

export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
    /** Add a wrapper with rounded corners and border */
    rounded?: boolean;
}

export const Table = forwardRef<HTMLTableElement, TableProps>(
    ({ className, rounded = true, children, ...props }, ref) => {
        const table = (
            <table
                ref={ref}
                className={cn('w-full text-sm', className)}
                {...props}
            >
                {children}
            </table>
        );

        if (rounded) {
            return (
                <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">{table}</div>
                </div>
            );
        }

        return table;
    }
);
Table.displayName = 'Table';

// ============================================================================
// Table Header
// ============================================================================

export const TableHeader = forwardRef<
    HTMLTableSectionElement,
    React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
    <thead
        ref={ref}
        className={cn('border-b border-border bg-muted/50', className)}
        {...props}
    />
));
TableHeader.displayName = 'TableHeader';

// ============================================================================
// Table Body
// ============================================================================

export const TableBody = forwardRef<
    HTMLTableSectionElement,
    React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
    <tbody
        ref={ref}
        className={cn('divide-y divide-border', className)}
        {...props}
    />
));
TableBody.displayName = 'TableBody';

// ============================================================================
// Table Row
// ============================================================================

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
    /** Enable hover highlight effect */
    hoverable?: boolean;
}

export const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(
    ({ className, hoverable = true, ...props }, ref) => (
        <tr
            ref={ref}
            className={cn(
                'group transition-colors',
                hoverable && 'hover:bg-accent/50',
                className
            )}
            {...props}
        />
    )
);
TableRow.displayName = 'TableRow';

// ============================================================================
// Table Head (th)
// ============================================================================

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
    /** Text alignment */
    align?: 'left' | 'center' | 'right';
}

export const TableHead = forwardRef<HTMLTableCellElement, TableHeadProps>(
    ({ className, align = 'left', ...props }, ref) => (
        <th
            ref={ref}
            className={cn(
                'px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider',
                align === 'left' && 'text-left',
                align === 'center' && 'text-center',
                align === 'right' && 'text-right',
                className
            )}
            {...props}
        />
    )
);
TableHead.displayName = 'TableHead';

// ============================================================================
// Table Cell (td)
// ============================================================================

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
    /** Text alignment */
    align?: 'left' | 'center' | 'right';
}

export const TableCell = forwardRef<HTMLTableCellElement, TableCellProps>(
    ({ className, align = 'left', ...props }, ref) => (
        <td
            ref={ref}
            className={cn(
                'px-6 py-4',
                align === 'left' && 'text-left',
                align === 'center' && 'text-center',
                align === 'right' && 'text-right',
                className
            )}
            {...props}
        />
    )
);
TableCell.displayName = 'TableCell';

// ============================================================================
// Table Loading State
// ============================================================================

export interface TableLoadingProps {
    /** Number of columns to span */
    colSpan: number;
    /** Loading message */
    message?: string;
}

export function TableLoading({ colSpan, message = 'Loading...' }: TableLoadingProps) {
    return (
        <TableRow hoverable={false}>
            <TableCell colSpan={colSpan} className="py-12">
                <div className="flex flex-col items-center justify-center gap-2">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
                    <p className="text-sm text-muted-foreground">{message}</p>
                </div>
            </TableCell>
        </TableRow>
    );
}

// ============================================================================
// Table Empty State
// ============================================================================

export interface TableEmptyProps {
    /** Number of columns to span */
    colSpan: number;
    /** Icon to display */
    icon?: React.ReactNode;
    /** Primary message */
    title?: string;
    /** Secondary message */
    description?: string;
    /** Optional action button */
    action?: React.ReactNode;
}

export function TableEmpty({
    colSpan,
    icon,
    title = 'No data found',
    description,
    action,
}: TableEmptyProps) {
    return (
        <TableRow hoverable={false}>
            <TableCell colSpan={colSpan} className="py-12">
                <div className="flex flex-col items-center justify-center gap-2">
                    {icon && (
                        <div className="text-muted-foreground/50">{icon}</div>
                    )}
                    <p className="text-sm font-medium text-foreground">{title}</p>
                    {description && (
                        <p className="text-xs text-muted-foreground">{description}</p>
                    )}
                    {action && <div className="mt-2">{action}</div>}
                </div>
            </TableCell>
        </TableRow>
    );
}

export default Table;
