import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import api from '../lib/api';

interface User {
  email: string;
  isAdmin: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Cookie-based: on load, ask the server who we are.
  useEffect(() => {
    api.auth
      .me()
      .then((data: any) => {
        // supports either { user: ... } or direct user payload
        setUser(data?.user ?? data);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      console.log('AUTH: submitting login', { email });

      const result = await api.auth.login(email, password);
      console.log('AUTH: login result', result);

      const me = await api.auth.me();
      console.log('AUTH: me after login', me);

      setUser((me as any)?.user ?? (me as any));
      return true;
    } catch (err) {
      console.error('LOGIN FAILED', err);
      setUser(null);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await api.auth.logout();
    } catch (err) {
      console.error('LOGOUT FAILED', err);
    } finally {
      setUser(null);
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
