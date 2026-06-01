import { Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster, toast } from 'sonner';
import { WarningCircle, CheckCircle, Warning, Info } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { rehydrateAuth } from '@/config';
import { useTheme } from '@/config/theme/ThemeProvider';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AdminRoute } from '@/features/admin/components/AdminRoute';
import { PlatformRoute } from '@/features/platform/components/PlatformRoute';
import { MainLayout } from '@/shared/layouts/MainLayout';
import { SpotlightSearch } from '@/features/search';
import { ZenModeHandler } from '@/components/layout/ZenModeHandler';
import { StreamingProvider } from '@/components/streaming/StreamingProvider';
import { FileViewerModal } from '@/features/files';
import { UploadTray } from '@/features/files/components/upload/UploadTray';
import { UploadBoot } from '@/features/files/components/upload/UploadBoot';
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';
import { PageLoader } from '@/components/feedback/PageLoader';
import { PageErrorFallback } from '@/components/feedback/PageErrorFallback';
import { AppErrorFallback } from '@/components/feedback/AppErrorFallback';
import { NotFoundPage } from '@/components/feedback/NotFoundPage';
import { AccessPolicyDialogProvider, AccessPolicyDialog } from '@/features/permissions';
import { MentionStateProvider } from '@/components/mention';
import { lazyImport } from '@/shared/utils/lazyImport';

// Expose toast on window in dev mode for testing
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__toast = toast;
}

// Lazy-loaded page components (route-level code splitting)
// Auth pages
const AuthForms = lazyImport(() => import('@/features/auth/components/AuthForms'), 'AuthForms');
const OrganizationPicker = lazyImport(() => import('@/features/auth/components/OrganizationPicker'), 'OrganizationPicker');
const AcceptInvitePage = lazyImport(() => import('@/features/auth/pages/AcceptInvitePage'), 'AcceptInvitePage');
const ForgotPasswordPage = lazyImport(() => import('@/features/auth/pages/ForgotPasswordPage'), 'ForgotPasswordPage');
const ResetPasswordPage = lazyImport(() => import('@/features/auth/pages/ResetPasswordPage'), 'ResetPasswordPage');
const EnrollmentPage = lazyImport(() => import('@/features/mfa/pages/EnrollmentPage'), 'EnrollmentPage');

// Dashboard
const Dashboard = lazyImport(() => import('@/features/dashboard/components/Dashboard'), 'Dashboard');

// Admin
const AdminLayout = lazyImport(() => import('@/features/admin/layouts/AdminLayout'), 'AdminLayout');
const MembersPage = lazyImport(() => import('@/features/admin/pages/MembersPage'), 'MembersPage');
const GroupsPage = lazyImport(() => import('@/features/admin/pages/GroupsPage'), 'GroupsPage');
const DomainAdminsPage = lazyImport(() => import('@/features/admin/pages/DomainAdminsPage'), 'DomainAdminsPage');
const PermissionsPage = lazyImport(() => import('@/features/admin/pages/PermissionsPage'), 'PermissionsPage');
const SupportAccessPage = lazyImport(() => import('@/features/admin/pages/SupportAccessPage'), 'SupportAccessPage');
const EncryptionPage = lazyImport(() => import('@/features/admin/pages/EncryptionPage'), 'EncryptionPage');
const EmailPage = lazyImport(() => import('@/features/admin/pages/EmailPage'), 'EmailPage');
const SecurityPage = lazyImport(() => import('@/features/admin/pages/SecurityPage'), 'SecurityPage');
const AuditLogsPage = lazyImport(() => import('@/features/admin/pages/AuditLogsPage'), 'AuditLogsPage');
const AdminAgentsPage = lazyImport(() => import('@/features/admin/pages/AgentsPage'), 'AgentsPage');
const StoragePage = lazyImport(() => import('@/features/admin/pages/StoragePage'), 'StoragePage');

// Platform (cross-tenant operator surface)
const PlatformLayout = lazyImport(() => import('@/features/platform/layouts/PlatformLayout'), 'PlatformLayout');
const PlatformOverviewPage = lazyImport(() => import('@/features/platform/pages/PlatformOverviewPage'), 'PlatformOverviewPage');
const PlatformOrganizationsPage = lazyImport(() => import('@/features/platform/pages/PlatformOrganizationsPage'), 'PlatformOrganizationsPage');
const PlatformUsersPage = lazyImport(() => import('@/features/platform/pages/PlatformUsersPage'), 'PlatformUsersPage');
const PlatformServerSettingsPage = lazyImport(() => import('@/features/admin/pages/ServerSettingsPage'), 'ServerSettingsPage');
const PlatformMailPage = lazyImport(() => import('@/features/platform/pages/PlatformMailPage'), 'PlatformMailPage');
const PlatformEncryptionPage = lazyImport(() => import('@/features/platform/pages/PlatformEncryptionPage'), 'PlatformEncryptionPage');
const PlatformAuditPage = lazyImport(() => import('@/features/platform/pages/PlatformAuditPage'), 'PlatformAuditPage');
const PlatformSessionsPage = lazyImport(() => import('@/features/platform/pages/PlatformSessionsPage'), 'PlatformSessionsPage');

// Content pages
const NotesPage = lazyImport(() => import('@/features/notes/pages/NotesPage'), 'NotesPage');
const CalendarPage = lazyImport(() => import('@/features/calendar/pages/CalendarPage'), 'CalendarPage');
const FilesPage = lazyImport(() => import('@/features/files/pages/FilesPage'), 'FilesPage');
const FiltersPage = lazyImport(() => import('@/features/files/pages/FiltersPage'), 'FiltersPage');
const FilesTrashPage = lazyImport(() => import('@/features/files/pages/FilesTrashPage'), 'FilesTrashPage');
const RoomsAdminPage = lazyImport(() => import('@/features/rooms/pages/RoomsPage'), 'RoomsPage');
const ProjectsPage = lazyImport(() => import('@/features/projects/pages/ProjectsPage'), 'ProjectsPage');
const PortfolioPage = lazyImport(() => import('@/features/projects/pages/PortfolioPage'), 'PortfolioPage');
const TaskRedirectPage = lazyImport(() => import('@/features/projects/pages/TaskRedirectPage'), 'TaskRedirectPage');
const ProjectSettingsPage = lazyImport(() => import('@/features/projects/pages/ProjectSettingsPage'), 'ProjectSettingsPage');
const AgentsPage = lazyImport(() => import('@/features/agents/pages/AgentsPage'), 'AgentsPage');
const ChatPage = lazyImport(() => import('@/features/chat/pages/ChatPage'), 'ChatPage');
const UserSettingsPage = lazyImport(() => import('@/features/settings/pages/SettingsPage'), 'SettingsPage');
const NotificationsPage = lazyImport(() => import('@/features/notifications/pages/NotificationsPage'), 'NotificationsPage');
const TagsExplorerPage = lazyImport(() => import('@/features/tags/pages/TagsExplorerPage'), 'TagsExplorerPage');

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme}
      position="top-right"
      icons={{
        error: <WarningCircle size={22} weight="fill" />,
        success: <CheckCircle size={22} weight="fill" />,
        warning: <Warning size={22} weight="fill" />,
        info: <Info size={22} weight="fill" />,
      }}
      toastOptions={{
        classNames: {
          toast: 'uniffy-toast',
          error: 'toast-error',
          success: 'toast-success',
          warning: 'toast-warning',
          info: 'toast-info',
        },
      }}
    />
  );
}

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

// Layout for authentication pages - full bleed, no padding (pages own their own layout)
function AuthLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-background text-foreground">
            {children}
        </div>
    );
}

/**
 * LazyRoute - Wraps lazy-loaded page components with Suspense and ErrorBoundary.
 *
 * Provides route-level error isolation: if a page crashes, the global chrome
 * (header, spotlight search, toaster) keeps working.
 */
function LazyRoute({ children }: { children: React.ReactNode }) {
    return (
        <ErrorBoundary fallback={(props) => <PageErrorFallback {...props} />}>
            <Suspense fallback={<PageLoader />}>
                {children}
            </Suspense>
        </ErrorBoundary>
    );
}

/**
 * AdminIndexRedirect - Redirects to the first admin page the user has access to.
 */
function AdminIndexRedirect() {
    const currentOrganizationRole = useAppSelector((state) => state.auth.currentOrganizationRole);
    const isSystemAdmin = useAppSelector((state) => state.auth.user?.isSystemAdmin);

    const isOrgAdmin = ['ADMIN', 'OWNER'].includes(currentOrganizationRole ?? '');
    if (isOrgAdmin) {
        return <Navigate to="/admin/members" replace />;
    }

    // Pure platform admin without org admin context belongs on /platform.
    if (isSystemAdmin) {
        return <Navigate to="/platform" replace />;
    }

    return <Navigate to="/" replace />;
}

export function App() {
    return (
        <AuthInitializer>
            <ErrorBoundary fallback={(props) => <AppErrorFallback {...props} />}>
                <BrowserRouter>
                    {/* Global Spotlight Search - available on all pages */}
                    <SpotlightSearch />
                    {/* Global File Viewer Modal - can be opened from search without navigating */}
                    <FileViewerModal />
                    {/* Global Zen Mode handler - toggles distraction-free mode */}
                    <ZenModeHandler />
                    {/* Global streaming connections (notifications, chat, presence) - mounts once, hooks no-op when unauthenticated */}
                    <StreamingProvider />
                    {/* Global toast notifications */}
                    <ThemedToaster />
                    {/* Global upload engine boot (mirror + reload recovery) and the floating transfers tray.
                        Mounted outside Routes so uploads survive navigation across every domain. */}
                    <UploadBoot />
                    <UploadTray />

                    <AccessPolicyDialogProvider>
                    <AccessPolicyDialog />

                    {/*
                     * MentionStateProvider sits above the router so every route
                     * (including layout-bypassing surfaces like chat) gets live
                     * mention chip state and the user's mentionDisplay setting.
                     * Mounting once at the top also avoids cache thrash on
                     * navigation.
                     */}
                    <MentionStateProvider>
                    <Routes>
                        <Route
                            path="/auth"
                            element={
                                <AuthLayout>
                                    <LazyRoute><AuthForms /></LazyRoute>
                                </AuthLayout>
                            }
                        />

                        <Route
                            path="/auth/accept-invite"
                            element={
                                <AuthLayout>
                                    <LazyRoute><AcceptInvitePage /></LazyRoute>
                                </AuthLayout>
                            }
                        />

                        <Route
                            path="/auth/forgot-password"
                            element={
                                <AuthLayout>
                                    <LazyRoute><ForgotPasswordPage /></LazyRoute>
                                </AuthLayout>
                            }
                        />

                        <Route
                            path="/auth/reset-password"
                            element={
                                <AuthLayout>
                                    <LazyRoute><ResetPasswordPage /></LazyRoute>
                                </AuthLayout>
                            }
                        />

                        <Route
                            path="/auth/enroll-mfa"
                            element={
                                <AuthLayout>
                                    <LazyRoute><EnrollmentPage /></LazyRoute>
                                </AuthLayout>
                            }
                        />

                        <Route
                            path="/select-org"
                            element={
                                <AuthLayout>
                                    <LazyRoute><OrganizationPicker /></LazyRoute>
                                </AuthLayout>
                            }
                        />

                        {/* Admin Routes - Unified for org admins and system admins */}
                        <Route
                            path="/admin"
                            element={
                                <AdminRoute>
                                    <LazyRoute><AdminLayout /></LazyRoute>
                                </AdminRoute>
                            }
                        >
                            <Route index element={<AdminIndexRedirect />} />

                            {/* Organization Admin Pages */}
                            <Route path="members" element={<LazyRoute><MembersPage /></LazyRoute>} />
                            <Route path="groups" element={<LazyRoute><GroupsPage /></LazyRoute>} />
                            <Route path="domain-admins" element={<LazyRoute><DomainAdminsPage /></LazyRoute>} />
                            <Route path="permissions" element={<LazyRoute><PermissionsPage /></LazyRoute>} />
                            <Route path="support-access" element={<LazyRoute><SupportAccessPage /></LazyRoute>} />
                            <Route path="security" element={<LazyRoute><SecurityPage /></LazyRoute>} />
                            <Route path="encryption" element={<LazyRoute><EncryptionPage /></LazyRoute>} />
                            <Route path="email" element={<LazyRoute><EmailPage /></LazyRoute>} />
                            <Route path="audit-logs" element={<LazyRoute><AuditLogsPage /></LazyRoute>} />
                            <Route path="agents" element={<LazyRoute><AdminAgentsPage /></LazyRoute>} />
                            <Route path="rooms" element={<LazyRoute><RoomsAdminPage /></LazyRoute>} />

                            {/* Storage Management */}
                            <Route path="storage" element={<LazyRoute><StoragePage /></LazyRoute>} />

                            {/* Legacy redirects to the platform surface */}
                            <Route path="organizations" element={<Navigate to="/platform/organizations" replace />} />
                            <Route path="users" element={<Navigate to="/platform/users" replace />} />
                            <Route path="server-settings" element={<Navigate to="/platform/server-settings" replace />} />
                            <Route path="settings" element={<Navigate to="/platform/server-settings" replace />} />

                            {/* 404 for admin */}
                            <Route path="*" element={<NotFoundPage compact heading="Admin Page Not Found" />} />
                        </Route>

                        {/* Platform Routes - Cross-tenant operator surface (system admins only) */}
                        <Route
                            path="/platform"
                            element={
                                <PlatformRoute>
                                    <LazyRoute><PlatformLayout /></LazyRoute>
                                </PlatformRoute>
                            }
                        >
                            <Route index element={<LazyRoute><PlatformOverviewPage /></LazyRoute>} />
                            <Route path="organizations" element={<LazyRoute><PlatformOrganizationsPage /></LazyRoute>} />
                            <Route path="users" element={<LazyRoute><PlatformUsersPage /></LazyRoute>} />
                            <Route path="sessions" element={<LazyRoute><PlatformSessionsPage /></LazyRoute>} />
                            <Route path="mail" element={<LazyRoute><PlatformMailPage /></LazyRoute>} />
                            <Route path="encryption" element={<LazyRoute><PlatformEncryptionPage /></LazyRoute>} />
                            <Route path="audit" element={<LazyRoute><PlatformAuditPage /></LazyRoute>} />
                            <Route path="server-settings" element={<LazyRoute><PlatformServerSettingsPage /></LazyRoute>} />
                            <Route path="*" element={<NotFoundPage compact heading="Platform Page Not Found" />} />
                        </Route>

                        <Route
                            path="/"
                            element={
                                <ProtectedRoute>
                                    <MainLayout>
                                        <LazyRoute><Dashboard /></LazyRoute>
                                    </MainLayout>
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/calendar"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><CalendarPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/calendar/:eventId"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><CalendarPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/notes"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><NotesPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/notes/graph"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><NotesPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/notes/tags"
                            element={<Navigate to="/tags?domain=note" replace />}
                        />

                        <Route
                            path="/notes/:noteId"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><NotesPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        {/* Files routes */}
                        <Route
                            path="/files"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><FilesPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/files/:fileId"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><FilesPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/files/filters"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><FiltersPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        {/* Phase 3 redirect; unified /tags explorer ships in Phase 5. */}
                        <Route
                            path="/files/tags"
                            element={<Navigate to="/tags?domain=file" replace />}
                        />

                        <Route
                            path="/files/trash"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><FilesTrashPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        {/* Portfolio */}
                        <Route
                            path="/portfolio"
                            element={
                                <ProtectedRoute>
                                    <MainLayout>
                                        <LazyRoute><PortfolioPage /></LazyRoute>
                                    </MainLayout>
                                </ProtectedRoute>
                            }
                        />

                        {/* Projects routes */}
                        <Route
                            path="/projects/task/:taskId"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><TaskRedirectPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/projects/:projectId/settings"
                            element={
                                <ProtectedRoute>
                                    <MainLayout>
                                        <LazyRoute><ProjectSettingsPage /></LazyRoute>
                                    </MainLayout>
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/projects"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><ProjectsPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/projects/:projectId"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><ProjectsPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/projects/:projectId/tasks/:taskId"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><ProjectsPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        {/* Chat routes */}
                        <Route
                            path="/chat"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><ChatPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/chat/unreads"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><ChatPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/chat/threads"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><ChatPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/chat/:channelId"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><ChatPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        {/* Agents routes */}
                        <Route
                            path="/agents"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><AgentsPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/agents/:tab"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><AgentsPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/agents/:tab/:subId"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><AgentsPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        {/* Notifications full page */}
                        <Route
                            path="/notifications"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><NotificationsPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        {/* Unified tags explorer */}
                        <Route
                            path="/tags"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><TagsExplorerPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />
                        <Route
                            path="/tags/:slug"
                            element={
                                <ProtectedRoute>
                                    <LazyRoute><TagsExplorerPage /></LazyRoute>
                                </ProtectedRoute>
                            }
                        />

                        {/* User settings (personal preferences only) */}
                        <Route
                            path="/settings"
                            element={
                                <ProtectedRoute>
                                    <MainLayout>
                                        <LazyRoute><UserSettingsPage /></LazyRoute>
                                    </MainLayout>
                                </ProtectedRoute>
                            }
                        />

                        {/* Redirect old routes */}
                        <Route path="/preferences" element={<Navigate to="/settings" replace />} />
                        <Route path="/organization" element={<Navigate to="/admin/groups" replace />} />

                        {/* Fallback for 404s */}
                        <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                    </MentionStateProvider>
                    </AccessPolicyDialogProvider>
                </BrowserRouter>
            </ErrorBoundary>
        </AuthInitializer>
    );
}
