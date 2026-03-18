import { ReactNode, useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Phone, Users, Database, LogOut } from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
}

type HealthStatus = 'ok' | 'degraded' | 'unknown';

function useSystemHealth(): HealthStatus {
  const [status, setStatus] = useState<HealthStatus>('unknown');

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        if (!mounted) return;
        setStatus(res.ok ? 'ok' : 'degraded');
      } catch {
        if (mounted) setStatus('degraded');
      }
    };

    check();
    const interval = setInterval(check, 30_000); // re-check every 30s
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  return status;
}

const HEALTH_DOT: Record<HealthStatus, { cls: string; pulse: boolean; title: string }> = {
  ok:       { cls: 'bg-green-500',  pulse: true,  title: 'All systems operational' },
  degraded: { cls: 'bg-red-500',    pulse: false, title: 'System issue detected' },
  unknown:  { cls: 'bg-gray-400',   pulse: false, title: 'Checking system status...' },
};

export default function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const health = useSystemHealth();
  const dot = HEALTH_DOT[health];

  const navigation = [
    { name: 'Clients', href: '/clients', icon: Users },
    { name: 'Leads',   href: '/leads',   icon: Database },
    { name: 'Calls',   href: '/calls',   icon: Phone },
  ];

  const isActive = (href: string) => location.pathname.startsWith(href);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Left: Logo + Nav */}
            <div className="flex items-center gap-8">
              <Link to="/" className="flex items-center gap-3 shrink-0">
                <div className="bg-blue-600 p-2 rounded-lg">
                  <Phone className="w-5 h-5 text-white" />
                </div>
                <span className="text-lg font-bold text-gray-900 hidden sm:block">Digital Switchboard</span>
              </Link>

              <div className="hidden md:flex items-center gap-1">
                {navigation.map(({ name, href, icon: Icon }) => {
                  const active = isActive(href);
                  return (
                    <Link
                      key={name}
                      to={href}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                        active ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {name}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Right: Health + User + Logout */}
            <div className="flex items-center gap-3">
              {/* System health dot */}
              <div className="flex items-center gap-1.5" title={dot.title}>
                <span className={`relative flex h-2.5 w-2.5`}>
                  {dot.pulse && (
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dot.cls}`} />
                  )}
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${dot.cls}`} />
                </span>
                <span className="text-xs text-gray-500 hidden sm:block">
                  {health === 'ok' ? 'Online' : health === 'degraded' ? 'Issue' : '…'}
                </span>
              </div>

              <div className="hidden sm:block h-4 w-px bg-gray-200" />

              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-gray-900 leading-tight">{user?.email}</p>
                <p className="text-xs text-gray-400">Admin</p>
              </div>

              <button
                onClick={logout}
                className="flex items-center gap-1.5 text-gray-500 hover:text-gray-800 px-2.5 py-2 rounded-lg hover:bg-gray-100 transition-colors text-sm"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
