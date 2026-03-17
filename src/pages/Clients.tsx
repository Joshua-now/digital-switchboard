import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { Plus, Phone, Settings, Users, TrendingUp, CheckCircle2, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';

interface Client {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  timezone: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  createdAt: string;
  routingConfigs: Array<{ provider?: string }>;
  _count: {
    leads: number;
    calls: number;
  };
}

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
      {type === 'error' ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
      {message}
    </div>
  );
}

const PROVIDER_BADGE: Record<string, string> = {
  BLAND: 'bg-purple-100 text-purple-700',
  VAPI: 'bg-blue-100 text-blue-700',
  TELNYX: 'bg-green-100 text-green-700',
};

export default function Clients() {
  const { token } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    timezone: 'America/New_York',
    quietHoursStart: '20:00',
    quietHoursEnd: '08:00',
  });

  useEffect(() => {
    loadClients();
  }, [token]);

  const loadClients = async () => {
    if (!token) return;
    try {
      const data = await api.clients.list(token);
      setClients(data);
    } catch (error) {
      console.error('Failed to load clients:', error);
      setToast({ message: 'Failed to load clients', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);

    try {
      await api.clients.create(formData, token);
      setShowForm(false);
      setFormData({
        name: '',
        timezone: 'America/New_York',
        quietHoursStart: '20:00',
        quietHoursEnd: '08:00',
      });
      setToast({ message: `Client "${formData.name}" created!`, type: 'success' });
      loadClients();
    } catch (error: any) {
      console.error('Failed to create client:', error);
      setToast({ message: error?.message || 'Failed to create client', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const totalLeads = clients.reduce((sum, c) => sum + c._count.leads, 0);
  const totalCalls = clients.reduce((sum, c) => sum + c._count.calls, 0);
  const activeClients = clients.filter(c => c.status === 'ACTIVE').length;

  return (
    <Layout>
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Clients</h1>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            New Client
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Clients</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{activeClients}</p>
              </div>
              <div className="bg-blue-100 p-3 rounded-lg">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Leads</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{totalLeads}</p>
              </div>
              <div className="bg-green-100 p-3 rounded-lg">
                <TrendingUp className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Calls</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{totalCalls}</p>
              </div>
              <div className="bg-orange-100 p-3 rounded-lg">
                <Phone className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Create form */}
        {showForm && (
          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <h2 className="text-xl font-semibold mb-4">Create New Client</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Client Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g. Acme Roofing Co."
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Timezone</label>
                  <select
                    value={formData.timezone}
                    onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="America/New_York">Eastern</option>
                    <option value="America/Chicago">Central</option>
                    <option value="America/Denver">Mountain</option>
                    <option value="America/Los_Angeles">Pacific</option>
                    <option value="America/Phoenix">Arizona</option>
                    <option value="Pacific/Honolulu">Hawaii</option>
                    <option value="America/Anchorage">Alaska</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Quiet Hours Start</label>
                  <input
                    type="time"
                    value={formData.quietHoursStart}
                    onChange={(e) => setFormData({ ...formData, quietHoursStart: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Quiet Hours End</label>
                  <input
                    type="time"
                    value={formData.quietHoursEnd}
                    onChange={(e) => setFormData({ ...formData, quietHoursEnd: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
                >
                  {submitting ? 'Creating...' : 'Create Client'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="bg-gray-100 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Client list */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Loading clients...</p>
          </div>
        ) : clients.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl shadow-sm border border-gray-100">
            <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600 mb-2">No clients yet.</p>
            <p className="text-gray-400 text-sm">Create your first client to get started.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Provider</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Leads</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Calls</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Timezone</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clients.map((client) => {
                  const provider = client.routingConfigs?.[0]?.provider;
                  return (
                    <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <Link
                          to={`/clients/${client.id}`}
                          className="font-medium text-blue-600 hover:text-blue-700"
                        >
                          {client.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                          client.status === 'ACTIVE'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {client.status === 'ACTIVE' ? '● Active' : '○ Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {provider ? (
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${PROVIDER_BADGE[provider] || 'bg-gray-100 text-gray-600'}`}>
                            {provider}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs italic">Not configured</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-600 text-sm">{client._count.leads}</td>
                      <td className="px-6 py-4 text-gray-600 text-sm">{client._count.calls}</td>
                      <td className="px-6 py-4 text-gray-500 text-sm">{client.timezone.replace('America/', '')}</td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          to={`/clients/${client.id}`}
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm font-medium"
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
        )}
      </div>
    </Layout>
  );
}
