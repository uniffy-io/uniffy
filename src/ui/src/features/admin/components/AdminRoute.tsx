import { Navigate, useLocation } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';

interface AdminRouteProps {
  children: React.ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps) {
  const { user, isAuthenticated } = useAppSelector((state) => state.auth);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // Access user properties directly from the PlainMessage
  if (!user || !user.isSystemAdmin) {
    // Redirect to home if not admin
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
