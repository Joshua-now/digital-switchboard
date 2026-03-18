import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { Plus, Phone, Settings, Users, TrendingUp, CheckCircle2, AlertCircle, Trash2, X, AlertTriangle, RefreshCw } from 'lucide-react';
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
  _count: { leads: number; calls: number };
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
      <button onClick={onClose} className="ml-1 opacity-70 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}

function DeleteModal({ client, onConfirm, onCancel, deleting }: {
  client: Client;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="bg-red-100 p-2.5 rounded-xl">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">Delete Client</h3>
            <p className="text-sm text-gray-500">This cannot be undone</p>
          </div>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 mb-5">
          <p className="text-sm text-red-800">
            You're about to permanently delete <strong>{client.name}</strong> and all associated leads ({client._count.leads}), calls ({client._count.calls}), and routing configuration.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-60"
          >
            {deleting ? <><RefreshCw className="w-4 h-4 animate-spin" />Deleting...</> : <><Trash2 className="w-4 h-4" />Yes, Delete</>}
          </button>
        </div>
      </div>
    </div>
  );
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

export default function Clients() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    timezone: 'America/New_York',
    quietHoursStart: '20:00',
    quietHoursEnd: '08:00',
  });

  const loadClients = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.clients.list();
      setClients(data);
    } catch (error) {
      console.error('Failed to load clients:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { if (user) loadClients(); }, [user, loadClients]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    setSubmitting(true);
    try {
      await api.clients.create(formData);
      setShowForm(false);
      setFormData({ name: '', timezone: 'America/New_York', quietHoursStart: '20:00', quietHoursEnd: '08:00' });
      setToast({ message: `"${formData.name}" created successfully!`, type: 'success' });
      loadClients();
    } catch (error: any) {
      console.error('Failed to create client:', error);
      setToast({ message: error?.message || 'Failed to create client', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.clients.delete(deleteTarget.id);
      setToast({ message: `"${deleteTarget.name}" deleted`, type: 'success' });
      setDeleteTarget(null);
      loadClients();
    } catch (error: any) {
      setToast({ message: error?.message || 'Failed to delete client', type: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  const totalLeads   = clients.reduce((s, c) => s + c._count.leads, 0);
  const totalCalls   = clients.reduce((s, c) => s + c._count.calls, 0);
  const activeCount  = clients.filter(c => c.status === 'ACTIVE').length;
  const unconfigured = clients.filter(c => !c.routingConfigs?.length).length;

  return (
    <Layout>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {deleteTarget && (
        <DeleteModal
          client={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Clients</h1>
            {unconfigured > 0 && (
              <p className="text-sm text-amber-600 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {unconfigured} client{unconfigured > 1 ? 's' : ''} not yet configured
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadClients}
              disabled={loading}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
            >
              <Plus className="w-4 h-4" />
              New Client
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

        {/* Load error */}
        {loadError && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
              <p className="text-sm text-red-700 font-medium">Failed to load clients</p>
            </div>
            <button onClick={loadClients} className="text-sm text-red-700 font-medium hover:underline flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" />Retry
            </button>
          </div>
        )}

        {/* Create form */}
        {showForm && (
          <div className="bg-white rounded-xl shadow-sm border border-blue-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Create New Client</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Client Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  placeholder="e.g. Acme Roofing Co."
                  autoFocus
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Timezone</label>
                  <select
                    value={formData.timezone}
                    onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  >
                    <option value="America/New_York">Eastern (ET)</option>
                    <option value="America/Chicago">Central (CT)</option>
                    <option value="America/Denver">Mountain (MT)</option>
                    <option value="America/Los_Angeles">Pacific (PT)</option>
                    <option value="America/Phoenix">Arizona (no DST)</option>
                    <option value="Pacific/Honolulu">Hawaii (HT)</option>
                    <option value="America/Anchorage">Alaska (AKT)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Quiet Hours Start</label>
                  <input
                    type="time"
                    value={formData.quietHoursStart}
                    onChange={(e) => setFormData({ ...formData, quietHoursStart: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Quiet Hours End</label>
                  <input
                    type="time"
                    value={formData.quietHoursEnd}
                    onChange={(e) => setFormData({ ...formData, quietHoursEnd: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={submitting || !formData.name.trim()}
                  className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50 shadow-sm"
                >
                  {submitting ? <><RefreshCw className="w-4 h-4 animate-spin" />Creating...</> : <><Plus className="w-4 h-4" />Create Client</>}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="bg-gray-100 text-gray-700 px-6 py-2.5 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Client list */}
        {loading && clients.length === 0 ? (
          <div className="text-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Loading clients...</p>
          </div>
        ) : !loadError && clients.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-gray-100">
            <Users className="w-16 h-16 text-gray-200 mx-auto mb-4" />
            <p className="text-gray-700 font-semibold mb-1">No clients yet</p>
            <p className="text-gray-400 text-sm mb-5">Create your first client to start routing speed-to-lead calls.</p>
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              <Plus className="w-4 h-4" />New Client
            </button>
          </div>
        ) : clients.length > 0 ? (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
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
                    <tr key={client.id} className="hover:bg-gray-50 transition-colors group">
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
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            to={`/clients/${client.id}`}
                            className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                          >
                            <Settings className="w-4 h-4" />
                            Manage
                          </Link>
                          <button
                            onClick={() => setDeleteTarget(client)}
                            className="inline-flex items-center gap-1.5 text-red-500 hover:text-red-600 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                            title="Delete client"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
