import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import {
  ArrowLeft, Phone, Settings, Users, TrendingUp,
  AlertTriangle, RefreshCw, Building2,
} from 'lucide-react';

interface Client {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  timezone: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  createdAt: string;
  routingConfigs: Array<{ provider?: string }>;
  _count: { leads: number; calls: number };
}

const PROVIDER_BADGE: Record<string, { label: string; cls: string }> = {
  BLAND:  { label: 'Bland AI', cls: 'bg-purple-100 text-purple-700' },
  VAPI:   { label: 'VAPI',     cls: 'bg-blue-100 text-blue-700' },
  TELNYX: { label: 'Telnyx',   cls: 'bg-green-100 text-green-700' },
};

const TZ_LABEL: Record<string, string> = {
  'America/New_York':    'Eastern',
  'America/Chicago':     'Central',
  'America/Denver':      'Mountain',
  'America/Los_Angeles': 'Pacific',
  'America/Phoenix':     'Arizona',
  'Pacific/Honolulu':    'Hawaii',
  'America/Anchorage':   'Alaska',
};

export default function AdminAgencyView() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Agency name passed via navigation state; fall back to fetching if missing
  const agencyName: string = (location.state as any)?.agencyName || 'Agency';

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Super admin only
  if (user && user.role !== 'SUPER_ADMIN') {
    navigate('/clients', { replace: true });
    return null;
  }

  const loadClients = useCallback(async () => {
    if (!user || !agencyId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.clients.list({ agencyId });
      setClients(data);
    } catch (err) {
      console.error('Failed to load agency clients:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [user, agencyId]);

  useEffect(() => {
    if (user) loadClients();
  }, [user, loadClients]);

  const totalLeads  = clients.reduce((s, c) => s + c._count.leads, 0);
  const totalCalls  = clients.reduce((s, c) => s + c._count.calls, 0);
  const activeCount = clients.filter(c => c.status === 'ACTIVE').length;
  const unconfigured = clients.filter(c => !c.routingConfigs?.length).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-40 shadow-sm">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <Link
            to="/admin"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-gray-700 shrink-0"
            title="Back to Admin"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900 leading-tight">{agencyName}</h1>
              <p className="text-xs text-gray-400">Super admin view · {agencyId?.slice(0, 8)}…</p>
            </div>
          </div>
          <button
            onClick={loadClients}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Active Clients', value: activeCount,  icon: Users,      bg: 'bg-blue-100',   icon_cls: 'text-blue-600' },
            { label: 'Total Leads',    value: totalLeads,   icon: TrendingUp,  bg: 'bg-green-100',  icon_cls: 'text-green-600' },
            { label: 'Total Calls',    value: totalCalls,   icon: Phone,       bg: 'bg-orange-100', icon_cls: 'text-orange-600' },
          ].map(({ label, value, icon: Icon, bg, icon_cls }) => (
            <div key={label} className="bg-white rounded-xl shadow-sm p-5 border border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
              </div>
              <div className={`${bg} p-3 rounded-xl`}>
                <Icon className={`w-6 h-6 ${icon_cls}`} />
              </div>
            </div>
          ))}
        </div>

        {/* Unconfigured warning */}
        {unconfigured > 0 && (
          <div className="flex items-center gap-2 text-sm text-amber-600">
            <AlertTriangle className="w-3.5 h-3.5" />
            {unconfigured} client{unconfigured > 1 ? 's' : ''} not yet configured
          </div>
        )}

        {/* Load error */}
        {loadError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
            <p className="text-sm text-red-700 font-medium">Failed to load clients</p>
            <button onClick={loadClients} className="text-sm text-red-700 font-medium hover:underline flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" />Retry
            </button>
          </div>
        )}

        {/* Client list */}
        {loading && clients.length === 0 ? (
          <div className="text-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Loading clients…</p>
          </div>
        ) : !loadError && clients.length === 0 && !loading ? (
          <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
            <Users className="w-16 h-16 text-gray-200 mx-auto mb-4" />
            <p className="text-gray-700 font-semibold mb-1">No clients yet</p>
            <p className="text-gray-400 text-sm">This agency hasn't created any clients.</p>
          </div>
        ) : clients.length > 0 ? (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Provider</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Leads</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Calls</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Timezone</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clients.map((client) => {
                  const provider = client.routingConfigs?.[0]?.provider;
                  const badge = provider ? PROVIDER_BADGE[provider] : null;
                  const tzLabel = TZ_LABEL[client.timezone] || client.timezone.replace('America/', '');
                  return (
                    <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <Link to={`/clients/${client.id}`} className="font-semibold text-blue-600 hover:text-blue-700">
                          {client.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                          client.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${client.status === 'ACTIVE' ? 'bg-green-500' : 'bg-gray-400'}`} />
                          {client.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {badge ? (
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
                            <AlertTriangle className="w-3 h-3" />Not configured
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-600 text-sm font-medium">{client._count.leads}</td>
                      <td className="px-6 py-4 text-gray-600 text-sm font-medium">{client._count.calls}</td>
                      <td className="px-6 py-4 text-gray-500 text-sm">{tzLabel}</td>
                      <td className="px-6 py-4">
                        <Link
                          to={`/clients/${client.id}`}
                          className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                        >
                          <Settings className="w-4 h-4" />
                          Manage
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
