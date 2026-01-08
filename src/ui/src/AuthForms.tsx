import { useState } from 'react';
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { AuthService } from "./gen/auth/v1/auth_connect";
import { UserInfoResponse } from "./gen/auth/v1/auth_pb";

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
  const [user, setUser] = useState<UserInfoResponse | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

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

      setAccessToken(response.accessToken);
      alert('Registration successful! You are now logged in.');
      await fetchCurrentUser(response.accessToken);
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

      setAccessToken(response.accessToken);
      alert('Login successful!');
      await fetchCurrentUser(response.accessToken);
    } catch (err: any) {
      setError(err.message || 'Login failed');
      console.error('Login error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentUser = async (token: string) => {
    try {
      console.log('Fetching current user with token:', token.substring(0, 20) + '...');
      
      const transport = createConnectTransport({
        baseUrl: API_BASE_URL,
      });
      const authenticatedClient = createClient(AuthService, transport);
      
      console.log('Calling getCurrentUser with Authorization header...');
      
      // Call with custom headers - ConnectRPC web uses interceptors for headers
      const response = await authenticatedClient.getCurrentUser(
        {},
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );
      
      console.log('User fetched successfully:', response);
      
      setUser(response);
    } catch (err: any) {
      console.error('Error fetching user:', err);
      console.error('Error details:', {
        message: err.message,
        code: err.code,
        details: err,
      });
      setError('Failed to fetch user info: ' + (err.message || 'Unknown error'));
    }
  };

  const handleLogout = () => {
    setAccessToken(null);
    setUser(null);
    setEmail('');
    setPassword('');
    setUsername('');
    setFullName('');
    setError(null);
  };

  // If user is logged in, show their info
  if (user && accessToken) {
    return (
      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '2rem' }}>
        <h1>Welcome, {user.username}! 👋</h1>
        
        <div style={{ 
          background: '#f5f5f5', 
          padding: '1.5rem', 
          borderRadius: '8px',
          marginTop: '1rem'
        }}>
          <h2>Your Profile</h2>
          <p><strong>Email:</strong> {user.email}</p>
          <p><strong>Username:</strong> {user.username}</p>
          {user.fullName && <p><strong>Full Name:</strong> {user.fullName}</p>}
          <p><strong>User ID:</strong> <code>{user.id}</code></p>
          <p><strong>Status:</strong> {user.isActive ? '✅ Active' : '❌ Inactive'}</p>
          <p><strong>Email Verified:</strong> {user.emailVerified ? '✅ Yes' : '❌ No'}</p>
          {user.isSystemAdmin && <p><strong>🔑 System Administrator</strong></p>}
        </div>

        <div style={{ 
          background: '#f9f9f9', 
          padding: '1rem', 
          borderRadius: '8px',
          marginTop: '1rem',
          fontSize: '0.8rem',
          wordBreak: 'break-all'
        }}>
          <strong>Access Token:</strong>
          <pre style={{ fontSize: '0.7rem', overflow: 'auto' }}>
            {accessToken}
          </pre>
        </div>

        <button 
          onClick={handleLogout}
          style={{ 
            marginTop: '1.5rem',
            padding: '0.75rem 1.5rem',
            background: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Logout
        </button>
      </div>
    );
  }

  // Show login/register forms
  return (
    <div style={{ maxWidth: '400px', margin: '0 auto', padding: '2rem' }}>
      <h1>UWOS Authentication</h1>
      
      <div style={{ marginBottom: '1.5rem' }}>
        <button
          onClick={() => setMode('login')}
          style={{
            padding: '0.5rem 1rem',
            marginRight: '0.5rem',
            background: mode === 'login' ? '#646cff' : '#f5f5f5',
            color: mode === 'login' ? 'white' : 'black',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Login
        </button>
        <button
          onClick={() => setMode('register')}
          style={{
            padding: '0.5rem 1rem',
            background: mode === 'register' ? '#646cff' : '#f5f5f5',
            color: mode === 'register' ? 'white' : 'black',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Register
        </button>
      </div>

      {error && (
        <div style={{ 
          background: '#fee', 
          color: '#c33', 
          padding: '1rem', 
          borderRadius: '4px',
          marginBottom: '1rem'
        }}>
          {error}
        </div>
      )}

      {mode === 'register' ? (
        <form onSubmit={handleRegister}>
          <h2>Create Account</h2>
          
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              Email *
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: '100%', padding: '0.5rem' }}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              Username *
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              style={{ width: '100%', padding: '0.5rem' }}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              Password *
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              style={{ width: '100%', padding: '0.5rem' }}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              Full Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              style={{ width: '100%', padding: '0.5rem' }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: '#646cff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '1rem'
            }}
          >
            {loading ? 'Creating account...' : 'Register'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleLogin}>
          <h2>Sign In</h2>
          
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: '100%', padding: '0.5rem' }}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: '100%', padding: '0.5rem' }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: '#646cff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '1rem'
            }}
          >
            {loading ? 'Signing in...' : 'Login'}
          </button>
        </form>
      )}

      <p style={{ marginTop: '1.5rem', fontSize: '0.9rem', color: '#666' }}>
        Using ConnectRPC for authentication
      </p>
    </div>
  );
}
