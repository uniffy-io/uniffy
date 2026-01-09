import { Navigate, useLocation } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, currentOrganizationId } = useAppSelector((state) => state.auth);
  const location = useLocation();

  if (!isAuthenticated) {
    // Redirect to auth page, but save the current location they were trying to go to
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (!currentOrganizationId) {
    return <Navigate to="/select-org" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
