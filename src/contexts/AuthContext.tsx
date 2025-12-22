import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../lib/api';

interface User {
  email: string;
  isAdmin: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    if (storedToken) {
      setToken(storedToken);
      api.auth
        .me(storedToken)
        .then((data) => {
          setUser(data.user);
        })
        .catch(() => {
          localStorage.removeItem('token');
          setToken(null);
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, []);
  const login = async (email: string, password: string) => {
  console.log("AUTH: submitting login", { email });

  const result = await api.auth.login(email, password);
  console.log("AUTH: login result", result);

  const me = await api.auth.me();
  console.log("AUTH: me after login", me);

  // keep the rest of your logic exactly as-is
};


  
  };

 const logout = async () => {
  setLoading(true);
  try {
    await api.auth.logout();
  } catch (err) {
    console.error("LOGOUT FAILED", err);
  } finally {
    setUser(null);
    setLoading(false);
  }
};


  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
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
