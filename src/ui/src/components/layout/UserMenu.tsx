import { useState, useEffect, useRef } from 'react';
import {
    SignOut,
    Moon,
    ShieldCheck,
    Sun,
    Desktop,
    UserCircle,
} from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { logout } from '@/features/auth/store/authSlice';
import { resetSettings } from '@/features/settings/store/settingsSlice';
import { clearNotes } from '@/features/notes/store/notesSlice';
import { clearTree } from '@/features/notes/store/notesTreeSlice';
import { clearNotesCache } from '@/features/notes';
import { clearBookmarks } from '@/features/bookmarks';
import { clearNotifications } from '@/features/notifications';
import { clearSharing } from '@/features/sharing';
import { clearAdmin, useAdminAccess } from '@/features/admin';
import { clearBlobCache } from '@/features/files';
import { clearComments } from '@/features/comments';
import { clearMemoryAccessToken } from '@/config/api';
import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { AuthService } from '@/gen/auth/v1/auth_connect';
import { useTheme } from '@/config/theme/ThemeProvider';
import { cn } from '@/shared/utils/cn';
import { useNavigate } from 'react-router-dom';

export function UserMenu() {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const { user, refreshToken } = useAppSelector((state) => state.auth);
    const { canAccessAdmin } = useAdminAccess();
    const { themeMode, setTheme, availableModes } = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;

        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }

        // Add listener on next tick to avoid the opening click from triggering close
        const timeoutId = setTimeout(() => {
            document.addEventListener('click', handleClickOutside, true);
        }, 0);

        return () => {
            clearTimeout(timeoutId);
            document.removeEventListener('click', handleClickOutside, true);
        };
    }, [isOpen]);

    if (!user) return null;

    const handleLogout = () => {
        // Notify backend to revoke the session (fire-and-forget)
        if (refreshToken) {
            const client = createClient(AuthService, transport);
            client.logout({ refreshToken }).catch(() => {});
        }
        // Clear memory access token (security: remove from memory)
        clearMemoryAccessToken();
        // Clear all user/org-specific state
        dispatch(logout());
        dispatch(resetSettings());
        dispatch(clearNotes());
        dispatch(clearTree());
        dispatch(clearBookmarks());
        dispatch(clearNotifications());
        dispatch(clearSharing());
        dispatch(clearAdmin());
        dispatch(clearComments());
        // Clear IndexedDB cache (async, fire and forget)
        clearNotesCache().catch(console.error);
        // Clear file blob cache
        clearBlobCache();
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

    const themeIcons = {
        dark: Moon,
        light: Sun,
        system: Desktop,
    };

    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "group relative flex items-center justify-center py-1.5 px-1.5 rounded-lg",
                    "transition-all duration-500 ease-out overflow-hidden",
                    "focus:outline-none"
                )}
            >
                {/* Hover/Active background */}
                <span
                    className={cn(
                        "absolute inset-0 rounded-lg transition-all duration-500",
                        isOpen ? "bg-primary/10" : "bg-transparent"
                    )}
                />

                {/* Hover underline effect - matching nav items */}
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />

                {/* Avatar container - matching nav item icon style */}
                <span className={cn(
                    "relative z-10 flex items-center justify-center w-7 h-7 rounded-md overflow-hidden",
                    "transition-all duration-500 ease-out",
                    !user.avatarUrl && (isOpen
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground group-hover:text-primary")
                )}>
                    {user.avatarUrl ? (
                        <img
                            src={user.avatarUrl}
                            alt=""
                            className="w-full h-full object-cover rounded-md"
                        />
                    ) : (
                        <span className={cn(
                            "flex items-center justify-center w-full h-full rounded-md text-[11px] font-bold tracking-tight",
                            "transition-all duration-300",
                            isOpen
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted/80 text-foreground group-hover:bg-primary/20 group-hover:text-primary"
                        )}>
                            {user.fullName
                                ? getInitials(user.fullName)
                                : (user.username || '??').slice(0, 2).toUpperCase()}
                        </span>
                    )}
                </span>
            </button>

            {isOpen && (
                <div className="absolute right-0 z-[100] mt-1.5 w-60 origin-top-right rounded-lg bg-card py-1.5 shadow-lg border border-border animate-in fade-in slide-in-from-top-2 duration-200">
                    {/* User info header */}
                    <div className="px-3 py-2.5 border-b border-border">
                        <div className="flex items-center gap-2.5">
                            <div className={cn(
                                "flex h-9 w-9 items-center justify-center rounded-lg overflow-hidden",
                                !user.avatarUrl && "bg-primary text-primary-foreground text-sm font-semibold"
                            )}>
                                {user.avatarUrl ? (
                                    <img
                                        src={user.avatarUrl}
                                        alt=""
                                        className="w-full h-full object-cover rounded-lg"
                                    />
                                ) : (
                                    user.fullName
                                        ? getInitials(user.fullName)
                                        : (user.username || '??').slice(0, 2).toUpperCase()
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-foreground truncate">
                                    {displayName}
                                </p>
                                <p className="text-xs text-muted-foreground truncate">
                                    {user.email}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Quick actions */}
                    <div className="py-1.5 px-1.5">
                        <button
                            onClick={() => {
                                navigate('/settings');
                                setIsOpen(false);
                            }}
                            className="group relative flex w-full items-center gap-2.5 px-2.5 py-2 text-sm rounded-md text-foreground/80 hover:text-foreground transition-colors overflow-hidden"
                        >
                            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 rounded-full bg-primary transition-all duration-300 ease-out group-hover:w-1/2 opacity-0 group-hover:opacity-70" />
                            <UserCircle size={16} weight="duotone" className="text-muted-foreground group-hover:text-primary transition-colors duration-200" />
                            <span>Settings</span>
                        </button>

                        {canAccessAdmin && (
                            <button
                                onClick={() => {
                                    navigate('/admin');
                                    setIsOpen(false);
                                }}
                                className="group relative flex w-full items-center gap-2.5 px-2.5 py-2 text-sm rounded-md text-foreground/80 hover:text-foreground transition-colors overflow-hidden"
                            >
                                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 rounded-full bg-primary transition-all duration-300 ease-out group-hover:w-1/2 opacity-0 group-hover:opacity-70" />
                                <ShieldCheck size={16} weight="duotone" className="text-muted-foreground group-hover:text-primary transition-colors duration-200" />
                                <span>Administration</span>
                            </button>
                        )}
                    </div>

                    {/* Theme switcher */}
                    <div className="border-t border-border py-1.5 px-1.5">
                        <div className="px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                            Appearance
                        </div>
                        <div className="flex gap-1 px-1.5">
                            {availableModes.map((mode) => {
                                const Icon = themeIcons[mode as keyof typeof themeIcons] || Desktop;
                                const isSelected = themeMode === mode;

                                return (
                                    <button
                                        key={mode}
                                        onClick={() => setTheme(mode)}
                                        className={cn(
                                            "group relative flex-1 flex flex-col items-center gap-1 py-2 px-1.5 rounded-md transition-all duration-200 overflow-hidden",
                                            isSelected
                                                ? "bg-primary/10 text-primary"
                                                : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-300 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />
                                        <Icon
                                            size={14}
                                            weight={isSelected ? "fill" : "duotone"}
                                            className={cn(
                                                "transition-colors duration-200",
                                                !isSelected && "group-hover:text-primary"
                                            )}
                                        />
                                        <span className="text-[10px] font-medium capitalize">{mode}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Sign out */}
                    <div className="border-t border-border pt-1.5 px-1.5">
                        <button
                            onClick={handleLogout}
                            className="group relative flex w-full items-center gap-2.5 px-2.5 py-2 text-sm rounded-md text-red-600 dark:text-red-400 transition-colors overflow-hidden"
                        >
                            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 rounded-full bg-red-500 transition-all duration-300 ease-out group-hover:w-1/2 opacity-0 group-hover:opacity-70" />
                            <SignOut size={16} weight="duotone" />
                            <span>Sign out</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
