import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { ArrowLeft, Copy, CheckCircle2, Phone, Settings } from 'lucide-react';
import Layout from '../components/Layout';

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
  active: boolean;
  callWithinSeconds: number;
  instructions: string;
  questions: string[] | null;
  transferNumber: string | null;
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const [client, setClient] = useState<Client | null>(null);
  const [config, setConfig] = useState<RoutingConfig | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const [formData, setFormData] = useState({
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

    try {
      const [clientData, configData] = await Promise.all([
        api.clients.get(id, token),
        api.clients.getRoutingConfig(id, token),
      ]);

      setClient(clientData);
      if (configData) {
        setConfig(configData);
        setFormData({
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
    }
  };

  const webhookUrl = `${window.location.origin.replace('5173', '3000')}/webhook/gohighlevel/${id}`;

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
      await api.clients.saveRoutingConfig(id, formData, token);
      setEditMode(false);
      loadData();
    } catch (error) {
      console.error('Failed to save config:', error);
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
      loadData();
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  if (!client) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-gray-600">Loading...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-gray-900">{client.name}</h1>
            <p className="text-gray-600 mt-1">
              {client.timezone} • Quiet hours: {client.quietHoursStart} - {client.quietHoursEnd}
            </p>
          </div>
          <button
            onClick={toggleClientStatus}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              client.status === 'ACTIVE'
                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {client.status}
          </button>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-blue-900 mb-2">Webhook URL</h3>
              <code className="text-sm text-blue-700 break-all">{webhookUrl}</code>
            </div>
            <button
              onClick={copyWebhookUrl}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors ml-4"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy
                </>
              )}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-blue-100 p-2 rounded-lg">
                <Settings className="w-6 h-6 text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Call Routing Configuration</h2>
            </div>
            {!editMode && config && (
              <button
                onClick={() => setEditMode(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Edit Configuration
              </button>
            )}
          </div>

          {editMode || !config ? (
            <form onSubmit={handleSave} className="space-y-6">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="active"
                  checked={formData.active}
                  onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <label htmlFor="active" className="text-sm font-medium text-gray-700">
                  Active (calls will be placed when enabled)
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Call Within Seconds
                </label>
                <input
                  type="number"
                  value={formData.callWithinSeconds}
                  onChange={(e) =>
                    setFormData({ ...formData, callWithinSeconds: Number(e.target.value) })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  min="0"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  AI Call Instructions
                </label>
                <textarea
                  value={formData.instructions}
                  onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-40"
                  placeholder="Enter the instructions for the AI agent..."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Transfer Number (Optional)
                </label>
                <input
                  type="tel"
                  value={formData.transferNumber}
                  onChange={(e) => setFormData({ ...formData, transferNumber: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="+1234567890"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Configuration'}
                </button>
                {config && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditMode(false);
                      setFormData({
                        active: config.active,
                        callWithinSeconds: config.callWithinSeconds,
                        instructions: config.instructions,
                        transferNumber: config.transferNumber || '',
                      });
                    }}
                    className="bg-gray-100 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                  config.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                }`}>
                  {config.active ? 'Active' : 'Inactive'}
                </span>
                <span className="text-gray-600">
                  Call within {config.callWithinSeconds} seconds
                </span>
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">Instructions</h4>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-gray-700 whitespace-pre-wrap">{config.instructions}</p>
                </div>
              </div>

              {config.transferNumber && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Transfer Number</h4>
                  <p className="text-gray-700">{config.transferNumber}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link
            to={`/leads?client=${id}`}
            className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 hover:border-blue-300 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">View Leads</h3>
                <p className="text-gray-600 text-sm">See all incoming leads for this client</p>
              </div>
              <ArrowLeft className="w-6 h-6 text-gray-400 group-hover:text-blue-600 transform rotate-180 transition-colors" />
            </div>
          </Link>

          <Link
            to={`/calls?client=${id}`}
            className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 hover:border-blue-300 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">View Calls</h3>
                <p className="text-gray-600 text-sm">See all call attempts for this client</p>
              </div>
              <ArrowLeft className="w-6 h-6 text-gray-400 group-hover:text-blue-600 transform rotate-180 transition-colors" />
            </div>
          </Link>
        </div>
      </div>
    </Layout>
  );
}
