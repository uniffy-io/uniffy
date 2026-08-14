import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "@/shared/utils/cn";

export interface TabItem {
  to: string;
  label: string;
  /** Match the route exactly instead of as a prefix. */
  end?: boolean;
  badge?: ReactNode;
  testId?: string;
}

interface TabsProps {
  items: TabItem[];
  className?: string;
}

/** Underline tab strip; active state derives from the route match. */
export function Tabs({ items, className }: TabsProps) {
  return (
    <nav className={cn("flex items-center gap-0", className)} data-testid="tabs">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          data-testid={item.testId}
          className={({ isActive }) =>
            cn(
              "inline-flex items-center gap-1.5 px-4 py-2 text-sm -mb-px border-b-2 transition-colors",
              isActive
                ? "text-primary border-primary font-medium"
                : "text-muted-foreground border-transparent hover:text-foreground",
            )
          }
        >
          {item.label}
          {item.badge}
        </NavLink>
      ))}
    </nav>
  );
}
