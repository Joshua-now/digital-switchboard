import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import {
  ArrowLeft, Copy, CheckCircle2, Settings,
  AlertCircle, Phone, Zap, Radio, RefreshCw,
  ToggleLeft, ToggleRight, ExternalLink, Clock,
  ChevronRight, Pencil, X,
} from 'lucide-react';
import Layout from '../components/Layout';

type CallProvider = 'BLAND' | 'VAPI' | 'TELNYX';

interface Client {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  timezone: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  ghlLocationId?: string | null;
}

interface RoutingConfig {
  id: string;
  provider: CallProvider;
  active: boolean;
  callWithinSeconds: number;
  instructions: string;
  questions: string[] | null;
  transferNumber: string | null;
  updatedAt?: string;
}

const PROVIDER_META: Record<CallProvider, { label: string; color: string; bg: string; border: string; icon: React.ElementType; desc: string }> = {
  BLAND: {
    label: 'Bland AI',
    color: 'text-purple-700',
    bg: 'bg-purple-50',
    border: 'border-purple-300',
    icon: Radio,
    desc: 'Reliable, cost-effective AI calling',
  },
  VAPI: {
    label: 'VAPI',
    color: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-300',
    icon: Zap,
    desc: 'Conversational AI with low latency',
  },
  TELNYX: {
    label: 'Telnyx',
    color: 'text-green-700',
    bg: 'bg-green-50',
    border: 'border-green-300',
    icon: Phone,
    desc: 'Ultra-low latency carrier-grade calls',
  },
};

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
      {type === 'error' ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
      {message}
      <button onClick={onClose} className="ml-1 opacity-70 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}

function ProviderCard({ provider, selected, onClick }: { provider: CallProvider; selected: boolean; onClick: () => void }) {
  const meta = PROVIDER_META[provider];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col gap-1.5 p-4 rounded-xl border-2 text-left transition-all ${
        selected
          ? `${meta.border} ${meta.bg} shadow-sm`
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      {selected && (
        <span className="absolute top-2.5 right-2.5 w-4 h-4 rounded-full bg-current flex items-center justify-center">
          <CheckCircle2 className={`w-4 h-4 ${meta.color}`} />
        </span>
      )}
      <div className={`flex items-center gap-2 font-semibold text-sm ${selected ? meta.color : 'text-gray-700'}`}>
        <Icon className="w-4 h-4" />
        {meta.label}
      </div>
      <p className="text-xs text-gray-500 leading-snug">{meta.desc}</p>
    </button>
  );
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [client, setClient] = useState<Client | null>(null);
  const [config, setConfig] = useState<RoutingConfig | null>(null);
  // Start loading=false — set to true only when we actually kick off the fetch
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [switchingProvider, setSwitchingProvider] = useState(false);
  const [editClientMode, setEditClientMode] = useState(false);
  const [editClientData, setEditClientData] = useState({
    name: '',
    timezone: 'America/New_York',
    quietHoursStart: '20:00',
    quietHoursEnd: '08:00',
    ghlLocationId: '',
  });
  const [savingClient, setSavingClient] = useState(false);

  const [formData, setFormData] = useState({
    provider: 'BLAND' as CallProvider,
    active: true,
    callWithinSeconds: 60,
    instructions: '',
    transferNumber: '',
  });

  const loadData = useCallback(async () => {
    if (!user || !id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [clientData, configData] = await Promise.all([
        api.clients.get(id),
        api.clients.getRoutingConfig(id).catch(() => null), // Don't let missing config crash the page
      ]);

      setClient(clientData);
      if (configData) {
        setConfig(configData);
        setFormData({
          provider: configData.provider || 'BLAND',
          active: configData.active,
          callWithinSeconds: configData.callWithinSeconds,
          instructions: configData.instructions,
          transferNumber: configData.transferNumber || '',
        });
        setEditMode(false);
      } else {
        setEditMode(true); // No config yet — jump straight to setup form
      }
    } catch (error: any) {
      console.error('Failed to load data:', error);
      const is404 = error?.status === 404 || error?.message?.toLowerCase().includes('not found');
      if (is404) {
        setLoadError('not_found');
      } else {
        setLoadError('error');
        setToast({ message: 'Failed to load client — retrying in 5s', type: 'error' });
        setTimeout(() => loadData(), 5000); // auto-retry on non-404 errors
      }
    } finally {
      setLoading(false);
    }
  }, [user, id]);

  useEffect(() => {
    if (user) loadData();
  }, [user, loadData]);

  const webhookUrl = `${window.location.origin}/webhook/gohighlevel/${id}`;

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    if (!formData.instructions.trim()) {
      setToast({ message: 'Instructions are required', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      await api.clients.saveRoutingConfig(id, {
        ...formData,
        transferNumber: formData.transferNumber || null,
      });
      setToast({ message: 'Configuration saved!', type: 'success' });
      await loadData();
    } catch (error: any) {
      console.error('Failed to save config:', error);
      setToast({ message: error?.message || 'Failed to save configuration', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // One-click provider switch without entering full edit mode
  const switchProvider = async (newProvider: CallProvider) => {
    if (!id || !config || newProvider === config.provider) return;
    setSwitchingProvider(true);
    try {
      await api.clients.saveRoutingConfig(id, {
        provider: newProvider,
        active: config.active,
        callWithinSeconds: config.callWithinSeconds,
        instructions: config.instructions,
        transferNumber: config.transferNumber,
      });
      setToast({ message: `Switched to ${PROVIDER_META[newProvider].label}`, type: 'success' });
      await loadData();
    } catch (error: any) {
      setToast({ message: error?.message || 'Failed to switch provider', type: 'error' });
    } finally {
      setSwitchingProvider(false);
    }
  };

  const toggleClientStatus = async () => {
    if (!id || !client) return;
    const newStatus = client.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await api.clients.update(id, { status: newStatus });
      setToast({
        message: `Client ${newStatus === 'ACTIVE' ? 'activated' : 'deactivated'}`,
        type: 'success',
      });
      await loadData();
    } catch (error: any) {
      setToast({ message: error?.message || 'Failed to update status', type: 'error' });
    }
  };

  const toggleConfigActive = async () => {
    if (!id || !config) return;
    try {
      await api.clients.saveRoutingConfig(id, {
        ...config,
        active: !config.active,
        transferNumber: config.transferNumber,
      });
      setToast({ message: config.active ? 'Calling paused' : 'Calling activated', type: 'success' });
      await loadData();
    } catch (error: any) {
      setToast({ message: error?.message || 'Failed to update', type: 'error' });
    }
  };

  const openEditClient = () => {
    if (!client) return;
    setEditClientData({
      name: client.name,
      timezone: client.timezone,
      quietHoursStart: client.quietHoursStart,
      quietHoursEnd: client.quietHoursEnd,
      ghlLocationId: client.ghlLocationId || '',
    });
    setEditClientMode(true);
  };

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSavingClient(true);
    try {
      await api.clients.update(id, {
        name: editClientData.name,
        timezone: editClientData.timezone,
        quietHoursStart: editClientData.quietHoursStart,
        quietHoursEnd: editClientData.quietHoursEnd,
        ghlLocationId: editClientData.ghlLocationId || null,
      });
      setToast({ message: 'Client updated!', type: 'success' });
      setEditClientMode(false);
      await loadData();
    } catch (error: any) {
      setToast({ message: error?.message || 'Failed to update client', type: 'error' });
    } finally {
      setSavingClient(false);
    }
  };

  // --- Render states ---

  if (loading && !client) {
    return (
      <Layout>
        <div className="text-center py-20">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading client...</p>
        </div>
      </Layout>
    );
  }

  if (loadError === 'not_found') {
    return (
      <Layout>
        <div className="text-center py-20">
          <AlertCircle className="w-14 h-14 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Client Not Found</h2>
          <p className="text-gray-500 text-sm mb-6">This client may have been deleted or the link is outdated.</p>
          <Link
            to="/clients"
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Clients
          </Link>
        </div>
      </Layout>
    );
  }

  if (!client) return null;

  const activeProvider = config?.provider;
  const configMeta = activeProvider ? PROVIDER_META[activeProvider] : null;
  const ConfigIcon = configMeta?.icon ?? Radio;

  return (
    <Layout>
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      {editClientMode && client && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Edit Client</h2>
              <button onClick={() => setEditClientMode(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveClient} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Client Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={editClientData.name}
                  onChange={(e) => setEditClientData({ ...editClientData, name: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  required
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Timezone</label>
                  <select
                    value={editClientData.timezone}
                    onChange={(e) => setEditClientData({ ...editClientData, timezone: e.target.value })}
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
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Quiet Start</label>
                    <input
                      type="time"
                      value={editClientData.quietHoursStart}
                      onChange={(e) => setEditClientData({ ...editClientData, quietHoursStart: e.target.value })}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Quiet End</label>
                    <input
                      type="time"
                      value={editClientData.quietHoursEnd}
                      onChange={(e) => setEditClientData({ ...editClientData, quietHoursEnd: e.target.value })}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  GHL Location ID <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={editClientData.ghlLocationId}
                  onChange={(e) => setEditClientData({ ...editClientData, ghlLocationId: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono"
                  placeholder="e.g. lZTzSBpnbKPGIKH4xyzA"
                />
                <p className="text-xs text-gray-400 mt-1">Used to match inbound webhooks by location.</p>
              </div>
              <div className="flex gap-3 pt-2 border-t border-gray-100">
                <button
                  type="submit"
                  disabled={savingClient || !editClientData.name.trim()}
                  className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
                >
                  {savingClient ? <><RefreshCw className="w-4 h-4 animate-spin" />Saving...</> : <><CheckCircle2 className="w-4 h-4" />Save Changes</>}
                </button>
                <button
                  type="button"
                  onClick={() => setEditClientMode(false)}
                  className="bg-gray-100 text-gray-700 px-6 py-2.5 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <Link to="/clients" className="mt-1 p-2 hover:bg-gray-100 rounded-lg transition-colors shrink-0">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900 truncate">{client.name}</h1>
              {/* Live status toggle */}
              <button
                onClick={toggleClientStatus}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                  client.status === 'ACTIVE'
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                title="Click to toggle client status"
              >
                {client.status === 'ACTIVE'
                  ? <><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Active</>
                  : <><span className="w-1.5 h-1.5 rounded-full bg-gray-400" />Inactive</>}
              </button>
            </div>
            <p className="text-gray-500 text-sm mt-0.5">
              {client.timezone} · Quiet hours {client.quietHoursStart}–{client.quietHoursEnd}
            </p>
          </div>
          <button
            onClick={openEditClient}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-xs font-medium shrink-0"
            title="Edit client settings"
          >
            <Pencil className="w-3.5 h-3.5" />Edit
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600 shrink-0"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT: Webhook + Quick Links */}
          <div className="space-y-4">
            {/* Webhook URL */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3">
                <p className="text-xs font-bold text-blue-100 uppercase tracking-wider">GHL Webhook URL</p>
                <p className="text-xs text-blue-200 mt-0.5">Paste into your GHL workflow → HTTP Request</p>
              </div>
              <div className="p-4">
                <code className="block text-xs text-gray-700 break-all bg-gray-50 rounded-lg p-3 border border-gray-100 leading-relaxed mb-3">
                  {webhookUrl}
                </code>
                <div className="flex gap-2">
                  <button
                    onClick={copyWebhookUrl}
                    className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium"
                  >
                    {copied ? <><CheckCircle2 className="w-3.5 h-3.5" />Copied!</> : <><Copy className="w-3.5 h-3.5" />Copy URL</>}
                  </button>
                  <a
                    href={`${webhookUrl}?test=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-3 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    title="Open webhook URL in new tab"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>

            {/* Quick nav */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100">
              <Link
                to={`/leads?client=${id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors group"
              >
                <span className="text-sm font-medium text-gray-700 group-hover:text-blue-600">View Leads</span>
                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-600" />
              </Link>
              <Link
                to={`/calls?client=${id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors group"
              >
                <span className="text-sm font-medium text-gray-700 group-hover:text-blue-600">View Calls</span>
                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-600" />
              </Link>
            </div>
          </div>

          {/* RIGHT: Routing Config (2/3 width) */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              {/* Config header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${configMeta ? configMeta.bg : 'bg-gray-100'}`}>
                    <ConfigIcon className={`w-5 h-5 ${configMeta ? configMeta.color : 'text-gray-500'}`} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">Call Routing</h2>
                    {config && !editMode && (
                      <p className={`text-xs font-medium ${configMeta?.color ?? 'text-gray-500'}`}>
                        {configMeta?.label} · {config.active ? 'Live' : 'Paused'}
                      </p>
                    )}
                    {!config && !editMode && (
                      <p className="text-xs text-amber-600 font-medium">⚠ Not configured yet</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {config && !editMode && (
                    <>
                      {/* Active / Pause toggle */}
                      <button
                        onClick={toggleConfigActive}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          config.active
                            ? 'bg-green-50 text-green-700 hover:bg-green-100'
                            : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                        }`}
                        title={config.active ? 'Pause outbound calling' : 'Resume outbound calling'}
                      >
                        {config.active
                          ? <><ToggleRight className="w-4 h-4" />Live</>
                          : <><ToggleLeft className="w-4 h-4" />Paused</>}
                      </button>
                      <button
                        onClick={() => setEditMode(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-xs font-medium"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                    </>
                  )}
                  {editMode && config && (
                    <button
                      onClick={() => {
                        setEditMode(false);
                        setFormData({
                          provider: config.provider || 'BLAND',
                          active: config.active,
                          callWithinSeconds: config.callWithinSeconds,
                          instructions: config.instructions,
                          transferNumber: config.transferNumber || '',
                        });
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors text-xs font-medium"
                    >
                      <X className="w-3.5 h-3.5" /> Cancel
                    </button>
                  )}
                </div>
              </div>

              {editMode || !config ? (
                /* ── EDIT FORM ── */
                <form onSubmit={handleSave} className="p-6 space-y-5">
                  {/* Provider selector */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">AI Call Provider</label>
                    <div className="grid grid-cols-3 gap-3">
                      {(['BLAND', 'VAPI', 'TELNYX'] as CallProvider[]).map((p) => (
                        <ProviderCard
                          key={p}
                          provider={p}
                          selected={formData.provider === p}
                          onClick={() => setFormData({ ...formData, provider: p })}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Active + Call window */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <input
                        type="checkbox"
                        id="active"
                        checked={formData.active}
                        onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                      />
                      <label htmlFor="active" className="text-sm font-medium text-gray-700 cursor-pointer">
                        Active (calls fire on lead arrival)
                      </label>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                        <Clock className="w-3 h-3 inline mr-1" />Call Within (seconds)
                      </label>
                      <input
                        type="number"
                        value={formData.callWithinSeconds}
                        onChange={(e) => setFormData({ ...formData, callWithinSeconds: Number(e.target.value) })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        min="0" max="3600" required
                      />
                    </div>
                  </div>

                  {/* Instructions */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      AI Agent Instructions
                    </label>
                    <p className="text-xs text-gray-500 mb-2">What should the AI say and do on the call? Be specific about the business, the goal, and how to handle objections.</p>
                    <textarea
                      value={formData.instructions}
                      onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-48 font-mono text-sm resize-y"
                      placeholder={`You are Anna, an AI assistant calling on behalf of [Company Name].\n\nYour goal is to confirm the lead's interest and schedule a follow-up with a human agent.\n\nKey points:\n- Be warm and professional\n- Ask qualifying questions\n- If interested, offer to transfer to [Name] at [Company]`}
                      required
                    />
                    <p className="text-xs text-gray-400 mt-1 text-right">{formData.instructions.length} chars</p>
                  </div>

                  {/* Transfer number */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      Transfer Number <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input
                      type="tel"
                      value={formData.transferNumber}
                      onChange={(e) => setFormData({ ...formData, transferNumber: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      placeholder="+14075551234"
                    />
                    <p className="text-xs text-gray-400 mt-1">Include country code. The AI will transfer hot leads to this number.</p>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 pt-1 border-t border-gray-100">
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm font-medium"
                    >
                      {saving ? <><RefreshCw className="w-4 h-4 animate-spin" />Saving...</> : <><CheckCircle2 className="w-4 h-4" />Save Configuration</>}
                    </button>
                  </div>
                </form>
              ) : (
                /* ── VIEW MODE ── */
                <div className="p-6 space-y-5">
                  {/* Provider quick-switch */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">AI Provider</p>
                    <div className={`grid grid-cols-3 gap-3 ${switchingProvider ? 'opacity-60 pointer-events-none' : ''}`}>
                      {(['BLAND', 'VAPI', 'TELNYX'] as CallProvider[]).map((p) => (
                        <ProviderCard
                          key={p}
                          provider={p}
                          selected={config.provider === p}
                          onClick={() => switchProvider(p)}
                        />
                      ))}
                    </div>
                    {switchingProvider && (
                      <p className="text-xs text-blue-600 mt-2 flex items-center gap-1">
                        <RefreshCw className="w-3 h-3 animate-spin" />Switching provider...
                      </p>
                    )}
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                      <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Call Window</p>
                      <p className="text-lg font-bold text-gray-800 mt-0.5">{config.callWithinSeconds}s</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                      <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Transfer To</p>
                      <p className="text-sm font-semibold text-gray-800 mt-0.5 truncate">
                        {config.transferNumber || <span className="text-gray-400 font-normal">Not set</span>}
                      </p>
                    </div>
                  </div>

                  {/* Instructions preview */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Agent Instructions</p>
                      <button
                        onClick={() => setEditMode(true)}
                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      >
                        <Pencil className="w-3 h-3" />Edit
                      </button>
                    </div>
                    <div className="bg-gray-50 border border-gray-100 rounded-lg p-4 max-h-48 overflow-y-auto">
                      <pre className="text-gray-700 text-xs font-mono whitespace-pre-wrap leading-relaxed">{config.instructions}</pre>
                    </div>
                  </div>

                  {config.updatedAt && (
                    <p className="text-xs text-gray-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Last updated {new Date(config.updatedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Help box when no config */}
            {!config && !editMode && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Routing not configured</p>
                    <p className="text-xs text-amber-700 mt-1">
                      This client won't place any calls until you configure a provider and agent instructions above.
                    </p>
                    <button
                      onClick={() => setEditMode(true)}
                      className="mt-2 text-xs bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 transition-colors font-medium"
                    >
                      Configure Now →
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
