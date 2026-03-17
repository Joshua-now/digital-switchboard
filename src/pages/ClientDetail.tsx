import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import {
  ArrowLeft, Copy, CheckCircle2, Settings,
  AlertCircle, Phone, Zap, Radio,
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
}

interface RoutingConfig {
  id: string;
  provider: CallProvider;
  active: boolean;
  callWithinSeconds: number;
  instructions: string;
  questions: string[] | null;
  transferNumber: string | null;
}

const PROVIDER_LABELS: Record<CallProvider, string> = {
  BLAND: 'Bland AI',
  VAPI: 'VAPI',
  TELNYX: 'Telnyx',
};

const PROVIDER_COLORS: Record<CallProvider, string> = {
  BLAND: 'bg-purple-100 text-purple-700',
  VAPI: 'bg-blue-100 text-blue-700',
  TELNYX: 'bg-green-100 text-green-700',
};

const PROVIDER_ICONS: Record<CallProvider, React.ElementType> = {
  BLAND: Radio,
  VAPI: Zap,
  TELNYX: Phone,
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
    </div>
  );
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const [client, setClient] = useState<Client | null>(null);
  const [config, setConfig] = useState<RoutingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [formData, setFormData] = useState({
    provider: 'BLAND' as CallProvider,
    active: true,
    callWithinSeconds: 60,
    instructions: '',
    transferNumber: '',
  });

  useEffect(() => {
    loadData();
  }, [id, token]);

  const loadData = async () => {
    if (!token || !id) return;
    setLoading(true);
    try {
      const [clientData, configData] = await Promise.all([
        api.clients.get(id, token),
        api.clients.getRoutingConfig(id, token),
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
      } else {
        setEditMode(true);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      setToast({ message: 'Failed to load client data', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Webhook URL uses the actual origin (works both local and Railway)
  const webhookUrl = `${window.location.origin}/webhook/gohighlevel/${id}`;

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !id) return;

    setSaving(true);
    try {
      await api.clients.saveRoutingConfig(id, {
        ...formData,
        transferNumber: formData.transferNumber || null,
      }, token);
      setEditMode(false);
      setToast({ message: 'Configuration saved!', type: 'success' });
      loadData();
    } catch (error: any) {
      console.error('Failed to save config:', error);
      setToast({ message: error?.message || 'Failed to save configuration', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const toggleClientStatus = async () => {
    if (!token || !id || !client) return;

    try {
      await api.clients.update(
        id,
        { status: client.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
        token
      );
      setToast({
        message: `Client ${client.status === 'ACTIVE' ? 'deactivated' : 'activated'}`,
        type: 'success',
      });
      loadData();
    } catch (error: any) {
      setToast({ message: error?.message || 'Failed to update status', type: 'error' });
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="text-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading client...</p>
        </div>
      </Layout>
    );
  }

  if (!client) {
    return (
      <Layout>
        <div className="text-center py-12">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-gray-600">Client not found.</p>
          <Link to="/" className="mt-4 inline-block text-blue-600 hover:underline">← Back to Clients</Link>
        </div>
      </Layout>
    );
  }

  const ProviderIcon = config ? PROVIDER_ICONS[config.provider] : Radio;

  return (
    <Layout>
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link to="/" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-gray-900">{client.name}</h1>
            <p className="text-gray-600 mt-1 text-sm">
              {client.timezone} · Quiet hours: {client.quietHoursStart}–{client.quietHoursEnd}
            </p>
          </div>
          <button
            onClick={toggleClientStatus}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              client.status === 'ACTIVE'
                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {client.status === 'ACTIVE' ? '● Active' : '○ Inactive'}
          </button>
        </div>

        {/* Webhook URL */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">GHL Webhook URL</p>
              <code className="text-sm text-blue-800 break-all">{webhookUrl}</code>
              <p className="text-xs text-blue-600 mt-1">Paste this into your GoHighLevel workflow → HTTP Request action</p>
            </div>
            <button
              onClick={copyWebhookUrl}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm shrink-0"
            >
              {copied ? (
                <><CheckCircle2 className="w-4 h-4" /> Copied!</>
              ) : (
                <><Copy className="w-4 h-4" /> Copy</>
              )}
            </button>
          </div>
        </div>

        {/* Routing Config */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-blue-100 p-2 rounded-lg">
                <Settings className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Call Routing Configuration</h2>
                {config && !editMode && (
                  <div className="flex items-center gap-2 mt-1">
                    <ProviderIcon className="w-3.5 h-3.5 text-gray-500" />
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PROVIDER_COLORS[config.provider]}`}>
                      {PROVIDER_LABELS[config.provider]}
                    </span>
                  </div>
                )}
              </div>
            </div>
            {!editMode && config && (
              <button
                onClick={() => setEditMode(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm"
              >
                Edit Configuration
              </button>
            )}
          </div>

          {editMode || !config ? (
            <form onSubmit={handleSave} className="space-y-5">
              {/* Provider selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  AI Call Provider
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {(['BLAND', 'VAPI', 'TELNYX'] as CallProvider[]).map((p) => {
                    const Icon = PROVIDER_ICONS[p];
                    const selected = formData.provider === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setFormData({ ...formData, provider: p })}
                        className={`flex items-center gap-2 px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                          selected
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {PROVIDER_LABELS[p]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Active toggle */}
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <input
                  type="checkbox"
                  id="active"
                  checked={formData.active}
                  onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <label htmlFor="active" className="text-sm font-medium text-gray-700">
                  Active — calls will be placed when a lead arrives
                </label>
              </div>

              {/* Call within seconds */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Call Within (seconds)
                </label>
                <input
                  type="number"
                  value={formData.callWithinSeconds}
                  onChange={(e) => setFormData({ ...formData, callWithinSeconds: Number(e.target.value) })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  min="0"
                  max="3600"
                  required
                />
              </div>

              {/* Instructions */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  AI Agent Instructions
                </label>
                <textarea
                  value={formData.instructions}
                  onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-48 font-mono text-sm"
                  placeholder="You are a helpful assistant calling on behalf of..."
                  required
                />
              </div>

              {/* Transfer number */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Transfer Number <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="tel"
                  value={formData.transferNumber}
                  onChange={(e) => setFormData({ ...formData, transferNumber: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="+14075551234"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm font-medium"
                >
                  {saving ? 'Saving...' : 'Save Configuration'}
                </button>
                {config && (
                  <button
                    type="button"
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
                    className="bg-gray-100 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 p-4 bg-gray-50 rounded-lg">
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                  config.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                }`}>
                  {config.active ? '● Active' : '○ Inactive'}
                </span>
                <span className="text-gray-600 text-sm">
                  Call within {config.callWithinSeconds}s
                </span>
                {config.transferNumber && (
                  <span className="text-gray-600 text-sm">
                    Transfer → {config.transferNumber}
                  </span>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Instructions</p>
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                  <p className="text-gray-700 text-sm whitespace-pre-wrap font-mono">{config.instructions}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            to={`/leads?client=${id}`}
            className="bg-white rounded-xl shadow-sm p-5 border border-gray-200 hover:border-blue-300 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">View Leads</h3>
                <p className="text-gray-500 text-sm mt-0.5">All incoming leads for this client</p>
              </div>
              <ArrowLeft className="w-5 h-5 text-gray-400 group-hover:text-blue-600 rotate-180 transition-colors" />
            </div>
          </Link>

          <Link
            to={`/calls?client=${id}`}
            className="bg-white rounded-xl shadow-sm p-5 border border-gray-200 hover:border-blue-300 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">View Calls</h3>
                <p className="text-gray-500 text-sm mt-0.5">All call attempts for this client</p>
              </div>
              <ArrowLeft className="w-5 h-5 text-gray-400 group-hover:text-blue-600 rotate-180 transition-colors" />
            </div>
          </Link>
        </div>
      </div>
    </Layout>
  );
}
