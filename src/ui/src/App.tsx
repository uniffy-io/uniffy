import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AuthForms from '@/features/auth/components/AuthForms';
import OrganizationPicker from '@/features/auth/components/OrganizationPicker';
import { MainLayout } from '@/layouts/MainLayout';
import { Home } from '@/features/home/Home';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AdminRoute } from '@/features/admin/components/AdminRoute';
import { AdminLayout } from '@/features/admin/layouts/AdminLayout';
import OrganizationsPage from '@/features/admin/pages/OrganizationsPage';
import UsersPage from '@/features/admin/pages/UsersPage';
import SettingsPage from '@/features/admin/pages/SettingsPage';
import OrgSettingsPage from '@/features/organization/pages/OrgSettingsPage';
import NotesPage from '@/features/notes/pages/NotesPage';
import { SettingsPage as UserSettingsPage } from '@/features/settings';
import { SpotlightSearch } from '@/features/search';
import { rehydrateAuth } from '@/config';
import { useAppSelector } from '@/app/hooks';

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
  }, []); // Only run once on mount

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

// Simple layout for authentication pages
function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
      {children}
    </div>
  );
}

export default function App() {
  return (
    <AuthInitializer>
      <BrowserRouter>
        {/* Global Spotlight Search - available on all pages */}
        <SpotlightSearch />

        <Routes>
        <Route path="/auth" element={
          <AuthLayout>
            <AuthForms />
          </AuthLayout>
        } />

        <Route path="/select-org" element={
          <AuthLayout>
            <OrganizationPicker />
          </AuthLayout>
        } />
        
        {/* Admin Routes */}
        <Route path="/admin" element={
          <AdminRoute>
            <AdminLayout />
          </AdminRoute>
        }>
          <Route index element={<Navigate to="/admin/organizations" replace />} />
          <Route path="organizations" element={<OrganizationsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="settings" element={<SettingsPage />} />
          {/* Placeholder for other admin pages */}
          <Route path="*" element={<div>Admin Page Not Found</div>} />
        </Route>

        <Route path="/" element={
          <ProtectedRoute>
            <MainLayout>
              <Home />
            </MainLayout>
          </ProtectedRoute>
        } />
        
        <Route path="/notes" element={
          <ProtectedRoute>
            <NotesPage />
          </ProtectedRoute>
        } />
        
        <Route path="/notes/:noteId" element={
          <ProtectedRoute>
            <NotesPage />
          </ProtectedRoute>
        } />
        
        {/* User settings (unified profile + preferences) */}
        <Route path="/settings" element={
          <ProtectedRoute>
            <MainLayout>
              <UserSettingsPage />
            </MainLayout>
          </ProtectedRoute>
        } />

        {/* Redirect old routes */}
        <Route path="/preferences" element={<Navigate to="/settings" replace />} />

        {/* Organization settings */}
        <Route path="/organization" element={
          <ProtectedRoute>
            <MainLayout>
              <OrgSettingsPage />
            </MainLayout>
          </ProtectedRoute>
        } />

        {/* Fallback for 404s */}
        <Route path="*" element={
          <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground">
            <h1 className="text-4xl font-bold mb-4">404</h1>
            <p className="text-muted-foreground mb-4">Page not found</p>
            <a href="/" className="text-primary hover:underline">Go back home</a>
          </div>
        } />
        </Routes>
      </BrowserRouter>
    </AuthInitializer>
  );
}
