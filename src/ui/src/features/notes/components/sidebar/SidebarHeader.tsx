import { useLocation } from 'react-router-dom';
import {
    CaretDoubleLeft,
    Atom,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAppDispatch } from '@/app/hooks';
import { toggleSidebar } from '@/features/notes/store/editorSlice';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { CompactNavItem } from '@/components/layout/CompactNavItem';
import { CreateDropdown } from '@/features/notes/components/sidebar/CreateDropdown';

interface NotesNavItem {
    name: string;
    path: string;
    icon: Icon;
}

const notesNavItems: NotesNavItem[] = [
    { name: 'Graph', path: '/notes/graph', icon: Atom },
];

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
    const { isMobile } = useBreakpoint();

    return (
        <div className="flex items-center px-3 pt-3 pb-2 gap-0.5">
            <CreateDropdown
                onCreateNote={onCreateNote}
                onCreateCanvas={onCreateCanvas}
                onCreateFolder={onCreateFolder}
                creating={creatingNote}
            />
            {notesNavItems.map((item) => (
                <CompactNavItem
                    key={item.path}
                    to={item.path}
                    label={item.name}
                    icon={item.icon}
                    isActive={location.pathname === item.path}
                />
            ))}
            <div className="flex-1" />
            {/* Mobile drawer has its own close. */}
            {!isMobile && (
                <button
                    onClick={() => dispatch(toggleSidebar())}
                    className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors shrink-0"
                    title="Toggle sidebar"
                >
                    <CaretDoubleLeft size={16} weight="bold" className="text-primary" />
                </button>
            )}
        </div>
    );
}
