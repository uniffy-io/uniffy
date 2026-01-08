import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { useNavigate } from 'react-router-dom';
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { setCredentials } from "../store/authSlice";

// Use environment variable or default to localhost
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://dev.local.uniffy.io:8000";

const transport = createConnectTransport({
  baseUrl: API_BASE_URL,
});

const authClient = createClient(AuthService, transport);

export default function AuthForms() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { isAuthenticated } = useAppSelector((state) => state.auth);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Form fields
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await authClient.register({
        email,
        username,
        password,
        fullName: fullName || undefined,
      });

      // Dispatch to Redux
      dispatch(setCredentials({
        user: response.user!,
        accessToken: response.accessToken
      }));
      
      // Navigation will be handled by the useEffect above
    } catch (err: any) {
      setError(err.message || 'Registration failed');
      console.error('Registration error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await authClient.login({
        email,
        password,
      });

      dispatch(setCredentials({
        user: response.user!,
        accessToken: response.accessToken
      }));

      // Navigation will be handled by the useEffect above
    } catch (err: any) {
      setError(err.message || 'Login failed');
      console.error('Login error:', err);
    } finally {
      setLoading(false);
    }
  };

  // If authenticated, we don't render anything while redirecting
  if (isAuthenticated) {
    return null; 
  }

  // Show login/register forms
  return (
    <div className="w-full max-w-md mx-auto p-8 border border-border rounded-xl shadow-sm bg-card text-card-foreground">
      <h1 className="text-3xl font-bold mb-8 text-center text-primary">UWOS</h1>
      
      <div className="flex gap-2 mb-6">
        <Button
          onClick={() => setMode('login')}
          variant={mode === 'login' ? 'default' : 'outline'}
          className="flex-1"
        >
          Login
        </Button>
        <Button
          onClick={() => setMode('register')}
          variant={mode === 'register' ? 'default' : 'outline'}
          className="flex-1"
        >
          Register
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded mb-6 text-sm">
          {error}
        </div>
      )}

      {mode === 'register' ? (
        <form onSubmit={handleRegister} className="space-y-4">
          <h2 className="text-xl font-semibold mb-4">Create Account</h2>
          
          <div>
            <label className="block text-sm font-medium mb-1">
              Email *
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Username *
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Password *
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Full Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none transition-all"
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Creating account...' : 'Register'}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleLogin} className="space-y-4">
          <h2 className="text-xl font-semibold mb-4">Sign In</h2>
          
          <div>
            <label className="block text-sm font-medium mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none transition-all"
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Signing in...' : 'Login'}
          </Button>
        </form>
      )}

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Secure authentication via ConnectRPC
      </p>
    </div>
  );
}

