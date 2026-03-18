import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { api } from '../lib/api';

export type User = {
  email: string;
  name: string | null;
  role: 'SUPER_ADMIN' | 'AGENCY_ADMIN';
  agencyId: string | null;
  agencyName: string | null;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (agencyName: string, name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On load, ask server who we are (cookie-based)
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const me = await api.auth.me();
        if (!mounted) return;
        setUser(me.user as User);
      } catch {
        if (!mounted) return;
        setUser(null);
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const res = await api.auth.login(email, password);
      setUser(res.user as User);
    } finally {
      setLoading(false);
    }
  };

  const signup = async (agencyName: string, name: string, email: string, password: string) => {
    setLoading(true);
    try {
      const res = await api.auth.signup(agencyName, name, email, password);
      setUser(res.user as User);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await api.auth.logout();
    } catch {
      // ignore
    } finally {
      setUser(null);
      setLoading(false);
    }
  };

  const value = useMemo(
    () => ({ user, loading, login, signup, logout }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
