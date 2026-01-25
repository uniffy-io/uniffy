import { useState, useEffect, useRef } from 'react';
import {
    ArrowRightStartOnRectangleIcon,
    MoonIcon,
    ShieldCheckIcon,
    SunIcon,
    ComputerDesktopIcon,
    UserCircleIcon,
} from '@heroicons/react/24/outline';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { logout } from '@/features/auth/store/authSlice';
import { resetSettings } from '@/features/settings/store/settingsSlice';
import { clearNotes } from '@/features/notes/store/notesSlice';
import { clearTree } from '@/features/notes/store/notesTreeSlice';
import { clearBookmarks } from '@/features/bookmarks';
import { clearSharing } from '@/features/sharing';
import { clearAdmin, useAdminAccess } from '@/features/admin';
import { clearMemoryAccessToken } from '@/config/api';
import { useTheme } from '@/theme/ThemeProvider';
import { cn } from '@/utils/cn';
import { useNavigate } from 'react-router-dom';

export function UserMenu() {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const { user } = useAppSelector((state) => state.auth);
    const { canAccessAdmin } = useAdminAccess();
    const { themeMode, setTheme, availableModes } = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [menuRef]);

    if (!user) return null;

    const handleLogout = () => {
        // Clear memory access token (security: remove from memory)
        clearMemoryAccessToken();
        // Clear all user/org-specific state
        dispatch(logout());
        dispatch(resetSettings());
        dispatch(clearNotes());
        dispatch(clearTree());
        dispatch(clearBookmarks());
        dispatch(clearSharing());
        dispatch(clearAdmin());
        // Navigate to auth page
        navigate('/auth');
    };

    const getInitials = (name: string) => {
        if (!name) return '??';
        return name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    const displayName = user.fullName || user.username || 'User';

    return (
        <div className="relative ml-3" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative flex max-w-xs items-center rounded-full bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background cursor-pointer hover:bg-muted transition-colors p-0.5"
            >
                <span className="sr-only">Open user menu</span>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary font-bold border border-primary/20 shadow-sm transition-transform active:scale-95">
                    {user.fullName
                        ? getInitials(user.fullName)
                        : (user.username || '??').slice(0, 2).toUpperCase()}
                </div>
            </button>

            {isOpen && (
                <div className="absolute right-0 z-[100] mt-2 w-56 origin-top-right rounded-md bg-card py-1 shadow-lg ring-1 ring-black/5 border border-border animate-in fade-in zoom-in duration-75">
                    <div className="px-4 py-3 border-b border-border">
                        <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
                        <p className="text-xs text-muted-foreground truncate font-normal">
                            {user.email}
                        </p>
                    </div>

                    <div className="py-1">
                        <button
                            onClick={() => {
                                navigate('/settings');
                                setIsOpen(false);
                            }}
                            className="group flex w-full items-center px-4 py-2 text-sm text-foreground/80 hover:bg-muted hover:text-foreground"
                        >
                            <UserCircleIcon
                                className="mr-3 h-5 w-5 text-muted-foreground group-hover:text-primary"
                                aria-hidden="true"
                            />
                            Settings
                        </button>

                        {canAccessAdmin && (
                            <button
                                onClick={() => {
                                    navigate('/admin');
                                    setIsOpen(false);
                                }}
                                className="group flex w-full items-center px-4 py-2 text-sm text-foreground/80 hover:bg-muted hover:text-foreground"
                            >
                                <ShieldCheckIcon
                                    className="mr-3 h-5 w-5 text-muted-foreground group-hover:text-primary"
                                    aria-hidden="true"
                                />
                                Administration
                            </button>
                        )}
                    </div>

                    <div className="border-t border-border py-1">
                        <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Theme
                        </div>
                        {availableModes.map((mode) => (
                            <button
                                key={mode}
                                onClick={() => setTheme(mode)}
                                className={cn(
                                    'group flex w-full items-center px-4 py-2 text-sm hover:bg-muted hover:text-foreground',
                                    themeMode === mode ? 'text-primary font-medium' : 'text-foreground/80'
                                )}
                            >
                                {mode === 'dark' ? (
                                    <MoonIcon
                                        className="mr-3 h-5 w-5 text-muted-foreground group-hover:text-primary"
                                        aria-hidden="true"
                                    />
                                ) : mode === 'light' ? (
                                    <SunIcon
                                        className="mr-3 h-5 w-5 text-muted-foreground group-hover:text-primary"
                                        aria-hidden="true"
                                    />
                                ) : (
                                    <ComputerDesktopIcon
                                        className="mr-3 h-5 w-5 text-muted-foreground group-hover:text-primary"
                                        aria-hidden="true"
                                    />
                                )}
                                {mode.charAt(0).toUpperCase() + mode.slice(1)}
                            </button>
                        ))}
                    </div>

                    <div className="border-t border-border py-1">
                        <button
                            onClick={handleLogout}
                            className="group flex w-full items-center px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                            <ArrowRightStartOnRectangleIcon
                                className="mr-3 h-5 w-5 group-hover:text-red-700 dark:group-hover:text-red-300"
                                aria-hidden="true"
                            />
                            Sign out
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
