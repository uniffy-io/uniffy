/**
 * Sidebar Header Component
 *
 * Header bar for the notes sidebar with create dropdown, nav items, and toggle button.
 */

import { Link, useLocation } from 'react-router-dom';
import {
    CaretDoubleLeft,
    Atom,
    Tag,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAppDispatch } from '@/app/hooks';
import { toggleSidebar } from '@/features/notes/store/editorSlice';
import { cn } from '@/shared/utils/cn';
import { CreateDropdown } from '@/features/notes/components/sidebar/CreateDropdown';

interface NotesNavItem {
    name: string;
    path: string;
    icon: Icon;
}

const notesNavItems: NotesNavItem[] = [
    { name: 'Graph', path: '/notes/graph', icon: Atom },
    { name: 'Tags', path: '/notes/tags', icon: Tag },
];

/**
 * Compact nav item that expands on hover to show label.
 * Matches the style of AppHeader's navigation items.
 */
function CompactNavItem({ item, isActive }: { item: NotesNavItem; isActive: boolean }) {
    const IconComponent = item.icon;

    return (
        <Link
            to={item.path}
            className={cn(
                "group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-700 ease-out overflow-hidden",
                "hover:px-2.5",
                isActive && "text-foreground"
            )}
        >
            {/* Active indicator */}
            <span
                className={cn(
                    "absolute inset-0 rounded-lg transition-all duration-500",
                    isActive ? "bg-primary/10" : "bg-transparent"
                )}
            />

            {/* Hover underline effect */}
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />

            {/* Icon */}
            <span className={cn(
                "relative z-10 flex items-center justify-center w-7 h-7 rounded-md transition-all duration-500 ease-out",
                isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground group-hover:text-primary"
            )}>
                <IconComponent size={18} weight={isActive ? "fill" : "duotone"} />
            </span>

            {/* Label - hidden by default, shows on hover */}
            <span className={cn(
                "relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out",
                "group-hover:ml-1.5 group-hover:max-w-24",
                isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
            )}>
                {item.name}
            </span>
        </Link>
    );
}

interface SidebarHeaderProps {
    onCreateNote: () => void;
    onCreateCanvas: () => void;
    onCreateFolder: () => void;
    creatingNote: boolean;
}

export function SidebarHeader({
    onCreateNote,
    onCreateCanvas,
    onCreateFolder,
    creatingNote,
}: SidebarHeaderProps) {
    const dispatch = useAppDispatch();
    const location = useLocation();

    return (
        <div className="flex items-center px-3 pt-3 pb-2 gap-0.5">
            <CreateDropdown
                onCreateNote={onCreateNote}
                onCreateCanvas={onCreateCanvas}
                onCreateFolder={onCreateFolder}
                creating={creatingNote}
            />
            {notesNavItems.map((item) => (
                <CompactNavItem key={item.path} item={item} isActive={location.pathname === item.path} />
            ))}
            <div className="flex-1" />
            <button
                onClick={() => dispatch(toggleSidebar())}
                className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors shrink-0"
                title="Toggle sidebar"
            >
                <CaretDoubleLeft size={16} weight="bold" className="text-primary" />
            </button>
        </div>
    );
}
