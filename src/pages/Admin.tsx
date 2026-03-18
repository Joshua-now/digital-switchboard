import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { Building2, Users, RefreshCw, CheckCircle, XCircle } from 'lucide-react';

type Agency = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  _count: { users: number; clients: number };
};

export default function Admin() {
  const { user } = useAuth();

  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  // Guard — non-super-admins should never see this page
  if (user && user.role !== 'SUPER_ADMIN') {
    return <Navigate to="/clients" replace />;
  }

  const loadAgencies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.admin.agencies.list();
      setAgencies(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load agencies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgencies();
  }, [loadAgencies]);

  const toggleStatus = async (agency: Agency) => {
    const newStatus = agency.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setToggling(agency.id);
    try {
      await api.admin.agencies.update(agency.id, { status: newStatus });
      setAgencies((prev) =>
        prev.map((a) => (a.id === agency.id ? { ...a, status: newStatus } : a))
      );
    } catch (err: any) {
      alert(err?.message || 'Failed to update agency');
    } finally {
      setToggling(null);
    }
  };

  const activeCount = agencies.filter((a) => a.status === 'ACTIVE').length;
  const suspendedCount = agencies.filter((a) => a.status === 'SUSPENDED').length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Agency Management</h1>
            <p className="text-sm text-gray-500 mt-0.5">Super admin — all agencies across Switchboard</p>
          </div>
          <button
            onClick={loadAgencies}
            disabled={loading}
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-bold text-gray-900">{agencies.length}</div>
            <div className="text-sm text-gray-500 mt-0.5">Total Agencies</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-bold text-green-600">{activeCount}</div>
            <div className="text-sm text-gray-500 mt-0.5">Active</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-bold text-red-500">{suspendedCount}</div>
            <div className="text-sm text-gray-500 mt-0.5">Suspended</div>
          </div>
        </div>

        {/* Agencies table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading && agencies.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">Loading agencies…</div>
          ) : error ? (
            <div className="p-12 text-center text-red-500 text-sm">{error}</div>
          ) : agencies.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">
              No agencies yet. Contractors sign up at /signup.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Agency</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Users</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Clients</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Created</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {agencies.map((agency) => (
                  <tr key={agency.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                          <Building2 size={15} className="text-blue-600" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{agency.name}</div>
                          <div className="text-xs text-gray-400 font-mono">{agency.id.slice(0, 8)}…</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 text-gray-600">
                        <Users size={13} className="text-gray-400" />
                        {agency._count.users}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-gray-600">{agency._count.clients}</td>
                    <td className="px-5 py-3.5 text-gray-500">
                      {new Date(agency.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3.5">
                      {agency.status === 'ACTIVE' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full">
                          <CheckCircle size={11} />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-1 rounded-full">
                          <XCircle size={11} />
                          Suspended
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => toggleStatus(agency)}
                        disabled={toggling === agency.id}
                        className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                          agency.status === 'ACTIVE'
                            ? 'text-red-600 hover:bg-red-50'
                            : 'text-green-700 hover:bg-green-50'
                        }`}
                      >
                        {toggling === agency.id
                          ? '…'
                          : agency.status === 'ACTIVE'
                          ? 'Suspend'
                          : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
