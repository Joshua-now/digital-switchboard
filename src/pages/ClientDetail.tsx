import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import {
  ArrowLeft, Copy, CheckCircle2, Settings,
  AlertCircle, Phone, Zap, Radio, RefreshCw,
  ToggleLeft, ToggleRight, ExternalLink, Clock,
  ChevronRight, Pencil, X, Plus, Trash2,
} from 'lucide-react';
import Layout from '../components/Layout';

type CallProvider = 'BLAND' | 'VAPI' | 'TELNYX';

interface Client {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  timezone: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  ghlLocationId?: string | null;
}

interface RoutingConfig {
  id: string;
  name: string;
  provider: CallProvider;
  active: boolean;
  callWithinSeconds: number;
  instructions?: string | null;
  questions: string[] | null;
  transferNumber: string | null;
  telnyxAssistantId: string | null;
  telnyxPhoneNumber: string | null;
  telnyxAppId: string | null;
  blandAgentId: string | null;
  vapiAssistantId: string | null;
  updatedAt?: string;
}

const PROVIDER_META: Record<CallProvider, { label: string; color: string; bg: string; border: string; icon: React.ElementType; desc: string }> = {
  BLAND: { label: 'Bland AI', color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-300', icon: Radio, desc: 'Reliable, cost-effective AI calling' },
  VAPI: { label: 'VAPI', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-300', icon: Zap, desc: 'Conversational AI with low latency' },
  TELNYX: { label: 'Telnyx', color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-300', icon: Phone, desc: 'Ultra-low latency carrier-grade calls' },
};

const EMPTY_FORM = {
  name: '',
  provider: 'TELNYX' as CallProvider,
  active: true,
  callWithinSeconds: 60,
  transferNumber: '',
  telnyxAssistantId: '',
  telnyxPhoneNumber: '',
  telnyxAppId: '',
  blandAgentId: '',
  vapiAssistantId: '',
};

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
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
    <button type="button" onClick={onClick}
      className={`relative flex flex-col gap-1.5 p-4 rounded-xl border-2 text-left transition-all ${selected ? `${meta.border} ${meta.bg} shadow-sm` : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'}`}>
      {selected && <span className="absolute top-2.5 right-2.5 w-4 h-4 rounded-full bg-current flex items-center justify-center"><CheckCircle2 className={`w-4 h-4 ${meta.color}`} /></span>}
      <div className={`flex items-center gap-2 font-semibold text-sm ${selected ? meta.color : 'text-gray-700'}`}><Icon className="w-4 h-4" />{meta.label}</div>
      <p className="text-xs text-gray-500 leading-snug">{meta.desc}</p>
    </button>
  );
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <button onClick={copy} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium">
      {copied ? <><CheckCircle2 className="w-3.5 h-3.5" />Copied!</> : <><Copy className="w-3.5 h-3.5" />{label}</>}
    </button>
  );
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [client, setClient] = useState<Client | null>(null);
  const [configs, setConfigs] = useState<RoutingConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Client edit
  const [editClientMode, setEditClientMode] = useState(false);
  const [editClientData, setEditClientData] = useState({ name: '', timezone: 'America/New_York', quietHoursStart: '', quietHoursEnd: '', ghlLocationId: '' });
  const [savingClient, setSavingClient] = useState(false);

  // Campaign modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<RoutingConfig | null>(null); // null = new
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!user || !id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [clientData, configsData] = await Promise.all([
        api.clients.get(id),
        api.clients.listRoutingConfigs(id).catch(() => []),
      ]);
      setClient(clientData);
      setConfigs(configsData);
    } catch (error: any) {
      const is404 = error?.status === 404 || error?.message?.toLowerCase().includes('not found');
      setLoadError(is404 ? 'not_found' : 'error');
      if (!is404) setTimeout(() => loadData(), 5000);
    } finally {
      setLoading(false);
    }
  }, [user, id]);

  useEffect(() => { if (user) loadData(); }, [user, loadData]);

  const openNewCampaign = () => {
    setEditingConfig(null);
    setFormData({ ...EMPTY_FORM });
    setModalOpen(true);
  };

  const openEditCampaign = (config: RoutingConfig) => {
    setEditingConfig(config);
    setFormData({
      name: config.name,
      provider: config.provider,
      active: config.active,
      callWithinSeconds: config.callWithinSeconds,
      transferNumber: config.transferNumber || '',
      telnyxAssistantId: config.telnyxAssistantId || '',
      telnyxPhoneNumber: config.telnyxPhoneNumber || '',
      telnyxAppId: config.telnyxAppId || '',
      blandAgentId: config.blandAgentId || '',
      vapiAssistantId: config.vapiAssistantId || '',
    });
    setModalOpen(true);
  };

  const handleSaveCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    try {
      const payload = {
        ...formData,
        name: formData.name.trim() || 'Campaign',
        transferNumber: formData.transferNumber || null,
        telnyxAssistantId: formData.telnyxAssistantId || null,
        telnyxPhoneNumber: formData.telnyxPhoneNumber || null,
        telnyxAppId: formData.telnyxAppId || null,
        blandAgentId: formData.blandAgentId || null,
        vapiAssistantId: formData.vapiAssistantId || null,
      };
      if (editingConfig) {
        await api.clients.updateRoutingConfig(id, editingConfig.id, payload);
        setToast({ message: 'Campaign updated!', type: 'success' });
      } else {
        await api.clients.createRoutingConfig(id, payload);
        setToast({ message: 'Campaign created!', type: 'success' });
      }
      setModalOpen(false);
      await loadData();
    } catch (error: any) {
      setToast({ message: error?.message || 'Failed to save campaign', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCampaign = async (configId: string, configName: string) => {
    if (!id || !confirm(`Delete campaign "${configName}"? This cannot be undone.`)) return;
    setDeletingId(configId);
    try {
      await api.clients.deleteRoutingConfig(id, configId);
      setToast({ message: `Campaign "${configName}" deleted`, type: 'success' });
      await loadData();
    } catch (error: any) {
      setToast({ message: error?.message || 'Failed to delete campaign', type: 'error' });
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleActive = async (config: RoutingConfig) => {
    if (!id) return;
    setTogglingId(config.id);
    try {
      await api.clients.updateRoutingConfig(id, config.id, { active: !config.active });
      setToast({ message: config.active ? `"${config.name}" paused` : `"${config.name}" activated`, type: 'success' });
      await loadData();
    } catch (error: any) {
      setToast({ message: error?.message || 'Failed to update', type: 'error' });
    } finally {
      setTogglingId(null);
    }
  };

  const toggleClientStatus = async () => {
    if (!id || !client) return;
    try {
      await api.clients.update(id, { status: client.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
      setToast({ message: `Client ${client.status === 'ACTIVE' ? 'deactivated' : 'activated'}`, type: 'success' });
      await loadData();
    } catch (error: any) {
      setToast({ message: error?.message || 'Failed to update status', type: 'error' });
    }
  };

  const openEditClient = () => {
    if (!client) return;
    setEditClientData({ name: client.name, timezone: client.timezone, quietHoursStart: client.quietHoursStart ?? '', quietHoursEnd: client.quietHoursEnd ?? '', ghlLocationId: client.ghlLocationId || '' });
    setEditClientMode(true);
  };

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSavingClient(true);
    try {
      await api.clients.update(id, { name: editClientData.name, timezone: editClientData.timezone, quietHoursStart: editClientData.quietHoursStart || null, quietHoursEnd: editClientData.quietHoursEnd || null, ghlLocationId: editClientData.ghlLocationId || null });
      setToast({ message: 'Client updated!', type: 'success' });
      setEditClientMode(false);
      await loadData();
    } catch (error: any) {
      setToast({ message: error?.message || 'Failed to update client', type: 'error' });
    } finally {
      setSavingClient(false);
    }
  };

  // ── Render states ──

  if (loading && !client) return (
    <Layout><div className="text-center py-20"><div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3" /><p className="text-gray-500 text-sm">Loading client...</p></div></Layout>
  );

  if (loadError === 'not_found') return (
    <Layout><div className="text-center py-20"><AlertCircle className="w-14 h-14 text-red-400 mx-auto mb-4" /><h2 className="text-xl font-semibold text-gray-800 mb-2">Client Not Found</h2><p className="text-gray-500 text-sm mb-6">This client may have been deleted or the link is outdated.</p><Link to="/clients" className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"><ArrowLeft className="w-4 h-4" /> Back to Clients</Link></div></Layout>
  );

  if (!client) return null;

  return (
    <Layout>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Edit Client Modal ── */}
      {editClientMode && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Edit Client</h2>
              <button onClick={() => setEditClientMode(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSaveClient} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Client Name <span className="text-red-500">*</span></label>
                <input type="text" value={editClientData.name} onChange={(e) => setEditClientData({ ...editClientData, name: e.target.value })} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm" required autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Timezone</label>
                  <select value={editClientData.timezone} onChange={(e) => setEditClientData({ ...editClientData, timezone: e.target.value })} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm">
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
                    <input type="time" value={editClientData.quietHoursStart} onChange={(e) => setEditClientData({ ...editClientData, quietHoursStart: e.target.value })} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Quiet End</label>
                    <input type="time" value={editClientData.quietHoursEnd} onChange={(e) => setEditClientData({ ...editClientData, quietHoursEnd: e.target.value })} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm" />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">GHL Location ID <span className="text-gray-400 font-normal">(optional)</span></label>
                <input type="text" value={editClientData.ghlLocationId} onChange={(e) => setEditClientData({ ...editClientData, ghlLocationId: e.target.value })} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono" placeholder="e.g. lZTzSBpnbKPGIKH4xyzA" />
              </div>
              <div className="flex gap-3 pt-2 border-t border-gray-100">
                <button type="submit" disabled={savingClient || !editClientData.name.trim()} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50">
                  {savingClient ? <><RefreshCw className="w-4 h-4 animate-spin" />Saving...</> : <><CheckCircle2 className="w-4 h-4" />Save Changes</>}
                </button>
                <button type="button" onClick={() => setEditClientMode(false)} className="bg-gray-100 text-gray-700 px-6 py-2.5 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Campaign Edit/Create Modal ── */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full my-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">{editingConfig ? 'Edit Campaign' : 'Add Campaign'}</h2>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSaveCampaign} className="p-6 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Campaign Name <span className="text-red-500">*</span></label>
                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm" placeholder="e.g. Speed to Lead" required autoFocus />
              </div>

              {/* Provider */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">AI Call Provider</label>
                <div className="grid grid-cols-3 gap-3">
                  {(['BLAND', 'VAPI', 'TELNYX'] as CallProvider[]).map((p) => (
                    <ProviderCard key={p} provider={p} selected={formData.provider === p} onClick={() => setFormData({ ...formData, provider: p })} />
                  ))}
                </div>
              </div>

              {/* Active + Call window */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <input type="checkbox" id="active" checked={formData.active} onChange={(e) => setFormData({ ...formData, active: e.target.checked })} className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500" />
                  <label htmlFor="active" className="text-sm font-medium text-gray-700 cursor-pointer">Active</label>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide"><Clock className="w-3 h-3 inline mr-1" />Call Within (sec)</label>
                  <input type="number" value={formData.callWithinSeconds} onChange={(e) => setFormData({ ...formData, callWithinSeconds: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm" min="0" max="3600" required />
                </div>
              </div>

              {/* Provider-specific fields */}
              {formData.provider === 'TELNYX' && (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Telnyx Assistant ID</label>
                    <input type="text" value={formData.telnyxAssistantId} onChange={(e) => setFormData({ ...formData, telnyxAssistantId: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono" placeholder="assistant-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Telnyx Phone Number</label>
                    <input type="text" value={formData.telnyxPhoneNumber} onChange={(e) => setFormData({ ...formData, telnyxPhoneNumber: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono" placeholder="+13217324521" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Telnyx App ID</label>
                    <input type="text" value={formData.telnyxAppId} onChange={(e) => setFormData({ ...formData, telnyxAppId: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono" placeholder="2917724292919592884" />
                  </div>
                </>
              )}
              {formData.provider === 'BLAND' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Bland Agent ID</label>
                  <input type="text" value={formData.blandAgentId} onChange={(e) => setFormData({ ...formData, blandAgentId: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                </div>
              )}
              {formData.provider === 'VAPI' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">VAPI Assistant ID</label>
                  <input type="text" value={formData.vapiAssistantId} onChange={(e) => setFormData({ ...formData, vapiAssistantId: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                </div>
              )}

              {/* Transfer number */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Transfer Number <span className="text-gray-400 font-normal">(optional)</span></label>
                <input type="tel" value={formData.transferNumber} onChange={(e) => setFormData({ ...formData, transferNumber: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm" placeholder="+14075551234" />
                <p className="text-xs text-gray-400 mt-1">Include country code. AI transfers hot leads here during business hours.</p>
              </div>

              <div className="flex gap-3 pt-1 border-t border-gray-100">
                <button type="submit" disabled={saving || !formData.name.trim()} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm font-medium">
                  {saving ? <><RefreshCw className="w-4 h-4 animate-spin" />Saving...</> : <><CheckCircle2 className="w-4 h-4" />{editingConfig ? 'Save Changes' : 'Create Campaign'}</>}
                </button>
                <button type="button" onClick={() => setModalOpen(false)} className="bg-gray-100 text-gray-700 px-6 py-2.5 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* ── Header ── */}
        <div className="flex items-start gap-4">
          <Link to="/clients" className="mt-1 p-2 hover:bg-gray-100 rounded-lg transition-colors shrink-0"><ArrowLeft className="w-5 h-5 text-gray-500" /></Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900 truncate">{client.name}</h1>
              <button onClick={toggleClientStatus} className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${client.status === 'ACTIVE' ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`} title="Click to toggle">
                {client.status === 'ACTIVE' ? <><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Active</> : <><span className="w-1.5 h-1.5 rounded-full bg-gray-400" />Inactive</>}
              </button>
            </div>
            <p className="text-gray-500 text-sm mt-0.5">{client.timezone} · {client.quietHoursStart && client.quietHoursEnd ? `Quiet ${client.quietHoursStart}–${client.quietHoursEnd}` : 'Always on (no quiet hours)'}</p>
          </div>
          <button onClick={openEditClient} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-xs font-medium shrink-0"><Pencil className="w-3.5 h-3.5" />Edit</button>
          <button onClick={loadData} disabled={loading} className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600 shrink-0" title="Refresh"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── LEFT: Quick Links ── */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100">
              <Link to={`/leads?client=${id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors group">
                <span className="text-sm font-medium text-gray-700 group-hover:text-blue-600">View Leads</span>
                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-600" />
              </Link>
              <Link to={`/calls?client=${id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors group">
                <span className="text-sm font-medium text-gray-700 group-hover:text-blue-600">View Calls</span>
                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-600" />
              </Link>
            </div>

            {/* Info box */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700 leading-relaxed">
              <p className="font-semibold mb-1 flex items-center gap-1.5"><Settings className="w-3.5 h-3.5" />How webhook URLs work</p>
              <p>Each campaign has its own unique webhook URL. Paste it into your GHL workflow → HTTP Request node. That way each automation triggers the right AI agent.</p>
            </div>
          </div>

          {/* ── RIGHT: Campaigns ── */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Campaigns</h2>
              <button onClick={openNewCampaign} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
                <Plus className="w-4 h-4" />Add Campaign
              </button>
            </div>

            {configs.length === 0 ? (
              <div className="bg-white rounded-xl border-2 border-dashed border-gray-200 p-10 text-center">
                <Radio className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-medium mb-1">No campaigns yet</p>
                <p className="text-gray-400 text-sm mb-4">Add a campaign to start routing calls for this client.</p>
                <button onClick={openNewCampaign} className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
                  <Plus className="w-4 h-4" />Add First Campaign
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {configs.map((config) => {
                  const meta = PROVIDER_META[config.provider];
                  const Icon = meta.icon;
                  const webhookUrl = `${window.location.origin}/webhook/gohighlevel/config/${config.id}`;
                  const isToggling = togglingId === config.id;
                  const isDeleting = deletingId === config.id;

                  return (
                    <div key={config.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                      {/* Card header */}
                      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`p-1.5 rounded-lg ${meta.bg} shrink-0`}><Icon className={`w-4 h-4 ${meta.color}`} /></div>
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900 text-sm">{config.name}</p>
                            <p className={`text-xs font-medium ${meta.color}`}>{meta.label}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleToggleActive(config)}
                            disabled={isToggling}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${config.active ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'} disabled:opacity-50`}
                          >
                            {isToggling ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : config.active ? <><ToggleRight className="w-3.5 h-3.5" />Live</> : <><ToggleLeft className="w-3.5 h-3.5" />Paused</>}
                          </button>
                          <button onClick={() => openEditCampaign(config)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors" title="Edit campaign"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleDeleteCampaign(config.id, config.name)} disabled={isDeleting} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50" title="Delete campaign">
                            {isDeleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      {/* Card body */}
                      <div className="px-5 py-4 space-y-3">
                        {/* Stats */}
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-xs text-gray-500 font-medium">Call Window</p>
                            <p className="font-semibold text-gray-800">{config.callWithinSeconds}s</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 font-medium">Transfer To</p>
                            <p className="font-semibold text-gray-800 truncate">{config.transferNumber || <span className="text-gray-400 font-normal text-xs">Not set</span>}</p>
                          </div>
                        </div>

                        {/* Agent ID */}
                        {config.provider === 'TELNYX' && config.telnyxAssistantId && (
                          <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                            <p className="text-xs text-gray-500 font-medium mb-0.5">Assistant ID</p>
                            <p className="text-xs font-mono text-green-800 truncate">{config.telnyxAssistantId}</p>
                          </div>
                        )}
                        {config.provider === 'BLAND' && config.blandAgentId && (
                          <div className="bg-purple-50 border border-purple-100 rounded-lg px-3 py-2">
                            <p className="text-xs text-gray-500 font-medium mb-0.5">Agent ID</p>
                            <p className="text-xs font-mono text-purple-800 truncate">{config.blandAgentId}</p>
                          </div>
                        )}
                        {config.provider === 'VAPI' && config.vapiAssistantId && (
                          <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                            <p className="text-xs text-gray-500 font-medium mb-0.5">Assistant ID</p>
                            <p className="text-xs font-mono text-blue-800 truncate">{config.vapiAssistantId}</p>
                          </div>
                        )}

                        {/* Webhook URL */}
                        <div className="bg-gray-50 rounded-lg border border-gray-100 p-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">GHL Webhook URL</p>
                          <code className="block text-xs text-gray-700 break-all mb-2 leading-relaxed">{webhookUrl}</code>
                          <div className="flex gap-2">
                            <CopyButton text={webhookUrl} label="Copy URL" />
                            <a href={webhookUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-white transition-colors" title="Open in new tab"><ExternalLink className="w-3.5 h-3.5" /></a>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
