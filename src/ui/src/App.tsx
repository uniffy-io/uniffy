import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AuthForms from '@/features/auth/components/AuthForms';
import { MainLayout } from '@/layouts/MainLayout';
import { Home } from '@/features/home/Home';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

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
        
        <Route path="/" element={
          <ProtectedRoute>
            <MainLayout>
              <Home />
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
