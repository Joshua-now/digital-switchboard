import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { login, loading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      await login(email.trim(), password);
      // If you have routing, your app should redirect based on user state.
      // Leave navigation to your route guard / App logic.
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <form
        onSubmit={handleSubmit}
        style={{
          width: 360,
          padding: 24,
          border: '1px solid #ddd',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0 }}>Sign in</h2>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="email"
          style={{ padding: 10, border: '1px solid #ccc', borderRadius: 8 }}
        />

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          style={{ padding: 10, border: '1px solid #ccc', borderRadius: 8 }}
        />

        {error && <div style={{ color: 'crimson' }}>{error}</div>}

        <button type="submit" disabled={loading} style={{ padding: 10, borderRadius: 8 }}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
