import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { Phone, Filter, ExternalLink } from 'lucide-react';
import Layout from '../components/Layout';

interface Call {
  id: string;
  status: string;
  outcome: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  client: {
    id: string;
    name: string;
  };
  lead: {
    id: string;
    phone: string;
    firstName: string | null;
    lastName: string | null;
  };
}

export default function Calls() {
  const [searchParams] = useSearchParams();
  const { token } = useAuth();
  const [calls, setCalls] = useState<Call[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);

  const clientId = searchParams.get('client') || undefined;

  useEffect(() => {
    loadCalls();
  }, [token, clientId]);

  const loadCalls = async () => {
    if (!token) return;

    try {
      const data = await api.calls.list({ clientId, limit: 50 }, token);
      setCalls(data.calls);
      setTotal(data.total);
    } catch (error) {
      console.error('Failed to load calls:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      CREATED: 'bg-blue-100 text-blue-700',
      IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
      COMPLETED: 'bg-green-100 text-green-700',
      FAILED: 'bg-red-100 text-red-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  const formatDuration = (start: string | null, end: string | null) => {
    if (!start || !end) return 'N/A';
    const duration = new Date(end).getTime() - new Date(start).getTime();
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Calls</h1>
            <p className="text-gray-600 mt-1">Total: {total} calls</p>
          </div>
          {clientId && (
            <Link
              to="/calls"
              className="text-blue-600 hover:text-blue-700 flex items-center gap-2"
            >
              <Filter className="w-4 h-4" />
              Clear Filter
            </Link>
          )}
        </div>

        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-600">Loading calls...</p>
          </div>
        ) : calls.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
            <Phone className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600">No calls found.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Contact</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Client</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Status</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Duration</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Outcome</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Created</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {calls.map((call) => (
                    <tr key={call.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-gray-900">
                            {call.lead.firstName || call.lead.lastName
                              ? `${call.lead.firstName || ''} ${call.lead.lastName || ''}`.trim()
                              : 'Unknown'}
                          </p>
                          <p className="text-sm text-gray-500">{call.lead.phone}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          to={`/clients/${call.client.id}`}
                          className="text-blue-600 hover:text-blue-700"
                        >
                          {call.client.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(
                            call.status
                          )}`}
                        >
                          {call.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {formatDuration(call.startedAt, call.endedAt)}
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {call.outcome ? (
                          <span className="text-sm">{call.outcome}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-600 text-sm">
                        {new Date(call.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => setSelectedCall(call)}
                          className="text-blue-600 hover:text-blue-700 font-medium text-sm"
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {selectedCall && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedCall(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-2xl font-bold text-gray-900">Call Details</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Contact</h3>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-gray-700">
                    {selectedCall.lead.firstName || selectedCall.lead.lastName
                      ? `${selectedCall.lead.firstName || ''} ${selectedCall.lead.lastName || ''}`.trim()
                      : 'Unknown'}
                  </p>
                  <p className="text-gray-600 text-sm">{selectedCall.lead.phone}</p>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Status</h3>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(
                      selectedCall.status
                    )}`}
                  >
                    {selectedCall.status}
                  </span>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Timing</h3>
                <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                  <p className="text-gray-700">
                    <span className="font-medium">Duration:</span>{' '}
                    {formatDuration(selectedCall.startedAt, selectedCall.endedAt)}
                  </p>
                  {selectedCall.startedAt && (
                    <p className="text-gray-700">
                      <span className="font-medium">Started:</span>{' '}
                      {new Date(selectedCall.startedAt).toLocaleString()}
                    </p>
                  )}
                  {selectedCall.endedAt && (
                    <p className="text-gray-700">
                      <span className="font-medium">Ended:</span>{' '}
                      {new Date(selectedCall.endedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              {selectedCall.outcome && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Outcome</h3>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <p className="text-gray-700">{selectedCall.outcome}</p>
                  </div>
                </div>
              )}

              {selectedCall.transcript && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Transcript</h3>
                  <div className="bg-gray-50 p-4 rounded-lg max-h-64 overflow-y-auto">
                    <p className="text-gray-700 whitespace-pre-wrap">{selectedCall.transcript}</p>
                  </div>
                </div>
              )}

              {selectedCall.recordingUrl && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Recording</h3>
                  <a
                    href={selectedCall.recordingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open Recording
                  </a>
                </div>
              )}
            </div>
            <div className="p-6 border-t border-gray-200">
              <button
                onClick={() => setSelectedCall(null)}
                className="w-full bg-gray-100 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
