import { Link } from "react-router-dom";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";

interface CompactNavItemProps {
    to: string;
    label: string;
    icon: Icon;
    isActive: boolean;
    testId?: string;
}

/** Icon-only sidebar link that slides its label out on hover. */
export function CompactNavItem({ to, label, icon: IconComponent, isActive, testId }: CompactNavItemProps) {
    return (
        <Link
            to={to}
            title={label}
            data-testid={testId}
            data-active={isActive ? "true" : "false"}
            className={cn(
                "group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-700 ease-out overflow-hidden",
                "hover:px-2.5",
                isActive && "text-foreground",
            )}
        >
            <span
                className={cn(
                    "absolute inset-0 rounded-lg transition-all duration-500",
                    isActive ? "bg-primary/10" : "bg-transparent",
                )}
            />

            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />

            <span
                className={cn(
                    "relative z-10 flex items-center justify-center w-7 h-7 rounded-md transition-all duration-500 ease-out",
                    isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground group-hover:text-primary",
                )}
            >
                <IconComponent size={18} weight={isActive ? "fill" : "duotone"} />
            </span>

            <span
                className={cn(
                    "relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out",
                    "group-hover:ml-1.5 group-hover:max-w-24",
                    isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                )}
            >
                {label}
            </span>
        </Link>
    );
}
