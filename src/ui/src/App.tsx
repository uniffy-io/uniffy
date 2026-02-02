import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthForms } from '@/features/auth/components/AuthForms';
import { OrganizationPicker } from '@/features/auth/components/OrganizationPicker';
import { MainLayout } from '@/layouts/MainLayout';
import { Home } from '@/features/home/Home';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AdminRoute } from '@/features/admin/components/AdminRoute';
import { AdminLayout } from '@/features/admin/layouts/AdminLayout';
// Organization admin pages
import MembersPage from '@/features/admin/pages/MembersPage';
import GroupsPage from '@/features/admin/pages/GroupsPage';
import PermissionsPage from '@/features/admin/pages/PermissionsPage';
import OrgSettingsPage from '@/features/admin/pages/OrgSettingsPage';
// Server admin pages
import OrganizationsPage from '@/features/admin/pages/OrganizationsPage';
import UsersPage from '@/features/admin/pages/UsersPage';
import ServerSettingsPage from '@/features/admin/pages/ServerSettingsPage';
// Other pages
import NotesPage from '@/features/notes/pages/NotesPage';
import { NotesTagsPage } from '@/features/notes/pages/NotesTagsPage';
import { SettingsPage as UserSettingsPage } from '@/features/settings';
import { SpotlightSearch } from '@/features/search';
import { ZenModeHandler } from '@/components/layout/ZenModeHandler';
import { rehydrateAuth } from '@/config';
import { useAppSelector } from '@/app/hooks';
import { CalendarPage } from '@/features/calendar';
import { FilesPage, FiltersPage, FilesTagsPage } from '@/features/files';

/**
 * AuthInitializer - Handles auth token rehydration on app startup.
 *
 * Security: Access tokens are stored in memory only (not localStorage).
 * On page reload, we use the persisted refresh token to get a new access token.
 * This validates the user is still active and their tokens haven't been revoked.
 */
function AuthInitializer({ children }: { children: React.ReactNode }) {
    const [isInitialized, setIsInitialized] = useState(false);
    const refreshToken = useAppSelector((state) => state.auth?.refreshToken);
    const isRehydrating = useAppSelector((state) => state.auth?.isRehydrating ?? false);

    useEffect(() => {
        const initAuth = async () => {
            if (refreshToken) {
                // We have a refresh token from localStorage, get a new access token
                await rehydrateAuth();
            }
            setIsInitialized(true);
        };

        initAuth();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only run once on mount, using initial refreshToken value
    }, []);

    // Show loading while initializing auth
    if (!isInitialized || isRehydrating) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-background">
                <div className="text-muted-foreground">Loading...</div>
            </div>
        );
    }

    return <>{children}</>;
}

// Layout for authentication pages — full bleed, no padding (pages own their own layout)
function AuthLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-background text-foreground">
            {children}
        </div>
    );
}

/**
 * AdminIndexRedirect - Redirects to the first admin page the user has access to.
 */
function AdminIndexRedirect() {
    const currentOrganizationRole = useAppSelector((state) => state.auth.currentOrganizationRole);
    const isSystemAdmin = useAppSelector((state) => state.auth.user?.isSystemAdmin);

    // If org admin, go to members page first
    const isOrgAdmin = ['ADMIN', 'OWNER'].includes(currentOrganizationRole ?? '');
    if (isOrgAdmin || isSystemAdmin) {
        return <Navigate to="/admin/members" replace />;
    }

    // System admin without org context goes to organizations
    if (isSystemAdmin) {
        return <Navigate to="/admin/organizations" replace />;
    }

    // Fallback - this shouldn't happen since AdminRoute blocks non-admins
    return <Navigate to="/" replace />;
}

export default function App() {
    return (
        <AuthInitializer>
            <BrowserRouter>
                {/* Global Spotlight Search - available on all pages */}
                <SpotlightSearch />
                {/* Global Zen Mode handler - toggles distraction-free mode */}
                <ZenModeHandler />

                <Routes>
                    <Route
                        path="/auth"
                        element={
                            <AuthLayout>
                                <AuthForms />
                            </AuthLayout>
                        }
                    />

                    <Route
                        path="/select-org"
                        element={
                            <AuthLayout>
                                <OrganizationPicker />
                            </AuthLayout>
                        }
                    />

                    {/* Admin Routes - Unified for org admins and system admins */}
                    <Route
                        path="/admin"
                        element={
                            <AdminRoute>
                                <AdminLayout />
                            </AdminRoute>
                        }
                    >
                        <Route index element={<AdminIndexRedirect />} />

                        {/* Organization Admin Pages */}
                        <Route path="members" element={<MembersPage />} />
                        <Route path="groups" element={<GroupsPage />} />
                        <Route path="permissions" element={<PermissionsPage />} />
                        <Route path="org-settings" element={<OrgSettingsPage />} />

                        {/* Server Admin Pages */}
                        <Route path="organizations" element={<OrganizationsPage />} />
                        <Route path="users" element={<UsersPage />} />
                        <Route path="server-settings" element={<ServerSettingsPage />} />

                        {/* Legacy route redirects */}
                        <Route path="settings" element={<Navigate to="/admin/server-settings" replace />} />

                        {/* 404 for admin */}
                        <Route path="*" element={<div>Admin Page Not Found</div>} />
                    </Route>

                    <Route
                        path="/"
                        element={
                            <ProtectedRoute>
                                <MainLayout>
                                    <Home />
                                </MainLayout>
                            </ProtectedRoute>
                        }
                    />

                    <Route
                        path="/calendar"
                        element={
                            <ProtectedRoute>
                                    <CalendarPage />
                            </ProtectedRoute>
                        }
                    />

                    <Route
                        path="/calendar/:eventId"
                        element={
                            <ProtectedRoute>
                                    <CalendarPage />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/notes"
                        element={
                            <ProtectedRoute>
                                <NotesPage />
                            </ProtectedRoute>
                        }
                    />

                    <Route
                        path="/notes/graph"
                        element={
                            <ProtectedRoute>
                                <NotesPage />
                            </ProtectedRoute>
                        }
                    />

                    <Route
                        path="/notes/tags"
                        element={
                            <ProtectedRoute>
                                <NotesTagsPage />
                            </ProtectedRoute>
                        }
                    />

                    <Route
                        path="/notes/:noteId"
                        element={
                            <ProtectedRoute>
                                <NotesPage />
                            </ProtectedRoute>
                        }
                    />

                    {/* Files routes */}
                    <Route
                        path="/files"
                        element={
                            <ProtectedRoute>
                                <FilesPage />
                            </ProtectedRoute>
                        }
                    />

                    <Route
                        path="/files/:fileId"
                        element={
                            <ProtectedRoute>
                                <FilesPage />
                            </ProtectedRoute>
                        }
                    />

                    <Route
                        path="/files/filters"
                        element={
                            <ProtectedRoute>
                                <FiltersPage />
                            </ProtectedRoute>
                        }
                    />

                    <Route
                        path="/files/tags"
                        element={
                            <ProtectedRoute>
                                <FilesTagsPage />
                            </ProtectedRoute>
                        }
                    />

                    {/* User settings (personal preferences only) */}
                    <Route
                        path="/settings"
                        element={
                            <ProtectedRoute>
                                <MainLayout>
                                    <UserSettingsPage />
                                </MainLayout>
                            </ProtectedRoute>
                        }
                    />

                    {/* Redirect old routes */}
                    <Route path="/preferences" element={<Navigate to="/settings" replace />} />
                    <Route path="/organization" element={<Navigate to="/admin/groups" replace />} />

                    {/* Fallback for 404s */}
                    <Route
                        path="*"
                        element={
                            <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground">
                                <h1 className="text-4xl font-bold mb-4">404</h1>
                                <p className="text-muted-foreground mb-4">Page not found</p>
                                <a href="/" className="text-primary hover:underline">
                                    Go back home
                                </a>
                            </div>
                        }
                    />
                </Routes>
            </BrowserRouter>
        </AuthInitializer>
    );
}
