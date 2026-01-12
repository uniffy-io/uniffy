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
import UserProfilePage from '@/features/auth/pages/UserProfilePage';
import NotesPage from '@/features/notes/pages/NotesPage';

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
    <BrowserRouter>
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
        
        <Route path="/profile" element={
          <ProtectedRoute>
            <MainLayout>
              <UserProfilePage />
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
        
        <Route path="/settings" element={
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
  );
}
