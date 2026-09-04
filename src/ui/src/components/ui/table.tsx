import { forwardRef } from "react";
import { cn } from "@/shared/utils/cn";

export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /** One rung above what the table sits on: `surface` on an app-frame page, `card` inside a surface block. */
  tone?: "surface" | "card";
  /** Draws the raised shell. Turn off when a parent already frames the table. */
  rounded?: boolean;
}

export const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ className, tone = "surface", rounded = true, children, ...props }, ref) => {
    const table = (
      <table
        ref={ref}
        className={cn(
          "w-full border-separate border-spacing-0 text-sm",
          tone === "surface" ? "[--table-tone:var(--surface)]" : "[--table-tone:var(--card)]",
          className,
        )}
        {...props}
      >
        {children}
      </table>
    );

    if (rounded) {
      return (
        // Horizontal scroll only below md: an ancestor with a non-visible overflow
        // becomes the containing block for the sticky header and pins it there.
        <div
          className={cn(
            "rounded-xl shadow-edge overflow-x-auto md:overflow-visible",
            tone === "surface" ? "bg-surface" : "bg-card",
          )}
        >
          {table}
        </div>
      );
    }

    return table;
  },
);
Table.displayName = "Table";

export const TableHeader = forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  // Layouts where the document itself scrolls under the sticky app header set
  // --sticky-top to the header height; inner scrollers leave it at zero.
  <thead
    ref={ref}
    className={cn("sticky top-[var(--sticky-top,0px)] z-10", className)}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

export const TableBody = forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&>tr:last-child>td]:border-b-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  hoverable?: boolean;
}

export const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, hoverable = true, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn("group", hoverable && "hover:bg-foreground/5 transition-colors", className)}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  align?: "left" | "center" | "right";
}

export const TableHead = forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, align = "left", ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "table-band border-b border-border/60 px-3 md:px-4 lg:px-6 py-2.5 md:py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider first:rounded-tl-xl last:rounded-tr-xl",
        align === "left" && "text-left",
        align === "center" && "text-center",
        align === "right" && "text-right",
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  align?: "left" | "center" | "right";
}

export const TableCell = forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, align = "left", ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        "border-b border-border/60 px-3 md:px-4 lg:px-6 py-2.5 md:py-3",
        align === "left" && "text-left",
        align === "center" && "text-center",
        align === "right" && "text-right",
        className,
      )}
      {...props}
    />
  ),
);
TableCell.displayName = "TableCell";

export interface TableLoadingProps {
  colSpan: number;
  message?: string;
}

export function TableLoading({ colSpan, message = "Loading..." }: TableLoadingProps) {
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

export interface TableEmptyProps {
  colSpan: number;
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export function TableEmpty({
  colSpan,
  icon,
  title = "No data found",
  description,
  action,
}: TableEmptyProps) {
  return (
    <TableRow hoverable={false}>
      <TableCell colSpan={colSpan} className="py-12">
        <div className="flex flex-col items-center justify-center gap-2">
          {icon && <div className="text-subtle-foreground">{icon}</div>}
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
          {action && <div className="mt-2">{action}</div>}
        </div>
      </TableCell>
    </TableRow>
  );
}
