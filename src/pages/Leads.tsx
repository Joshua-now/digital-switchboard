import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { Database, Filter, Eye, Search, ChevronLeft, ChevronRight, X } from 'lucide-react';
import Layout from '../components/Layout';

interface Lead {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  email: string | null;
  callStatus: string;
  skipReason: string | null;
  createdAt: string;
  client: {
    id: string;
    name: string;
  };
  calls: Array<{
    id: string;
    status: string;
    outcome: string | null;
  }>;
}

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'NEW', label: 'New' },
  { value: 'QUEUED', label: 'Queued' },
  { value: 'CALLING', label: 'Calling' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'SKIPPED', label: 'Skipped' },
];

export default function Leads() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const clientId = searchParams.get('client') || undefined;

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [statusFilter, clientId]);

  const loadLeads = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await api.leads.list({
        clientId,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        search: search || undefined,
        status: statusFilter || undefined,
      });
      setLeads(data.leads);
      setTotal(data.total);
    } catch (error) {
      console.error('Failed to load leads:', error);
    } finally {
      setLoading(false);
    }
  }, [user, clientId, search, statusFilter, page]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      NEW: 'bg-blue-100 text-blue-700',
      QUEUED: 'bg-yellow-100 text-yellow-700',
      CALLING: 'bg-orange-100 text-orange-700',
      COMPLETED: 'bg-green-100 text-green-700',
      FAILED: 'bg-red-100 text-red-700',
      SKIPPED: 'bg-gray-100 text-gray-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Leads</h1>
            <p className="text-gray-600 mt-1">
              {total > 0 ? `${start}–${end} of ${total} leads` : `${total} leads`}
            </p>
          </div>
          {clientId && (
            <Link
              to="/leads"
              className="text-blue-600 hover:text-blue-700 flex items-center gap-2 text-sm"
            >
              <Filter className="w-4 h-4" />
              Clear Client Filter
            </Link>
          )}
        </div>

        {/* Search + filter bar */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, phone, email…"
              className="w-full pl-9 pr-9 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
            {searchInput && (
              <button
                onClick={() => { setSearchInput(''); setSearch(''); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm bg-white"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Loading leads...</p>
          </div>
        ) : leads.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
            <Database className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600">
              {search || statusFilter ? 'No leads match your filters.' : 'No leads found.'}
            </p>
            {(search || statusFilter) && (
              <button
                onClick={() => { setSearchInput(''); setSearch(''); setStatusFilter(''); }}
                className="mt-3 text-sm text-blue-600 hover:text-blue-700"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Contact</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Phone</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Client</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Status</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Calls</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Created</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {leads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-gray-900">
                            {lead.firstName || lead.lastName
                              ? `${lead.firstName || ''} ${lead.lastName || ''}`.trim()
                              : 'Unknown'}
                          </p>
                          {lead.email && (
                            <p className="text-sm text-gray-500">{lead.email}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-600">{lead.phone}</td>
                      <td className="px-6 py-4">
                        <Link
                          to={`/clients/${lead.client.id}`}
                          className="text-blue-600 hover:text-blue-700"
                        >
                          {lead.client.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(
                            lead.callStatus
                          )}`}
                        >
                          {lead.callStatus}
                        </span>
                        {lead.skipReason && (
                          <p className="text-xs text-gray-500 mt-1">{lead.skipReason}</p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-600">{lead.calls.length}</td>
                      <td className="px-6 py-4 text-gray-600 text-sm">
                        {new Date(lead.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => setSelectedLead(lead)}
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700"
                        >
                          <Eye className="w-4 h-4" />
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50">
                <p className="text-sm text-gray-500">
                  {start}–{end} of {total}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-white hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-gray-600 font-medium">
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-white hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedLead && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedLead(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-2xl font-bold text-gray-900">Lead Details</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Contact Information</h3>
                <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                  <p className="text-gray-700">
                    <span className="font-medium">Name:</span>{' '}
                    {selectedLead.firstName || selectedLead.lastName
                      ? `${selectedLead.firstName || ''} ${selectedLead.lastName || ''}`.trim()
                      : 'Unknown'}
                  </p>
                  <p className="text-gray-700">
                    <span className="font-medium">Phone:</span> {selectedLead.phone}
                  </p>
                  {selectedLead.email && (
                    <p className="text-gray-700">
                      <span className="font-medium">Email:</span> {selectedLead.email}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Status</h3>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(
                      selectedLead.callStatus
                    )}`}
                  >
                    {selectedLead.callStatus}
                  </span>
                  {selectedLead.skipReason && (
                    <p className="text-gray-600 mt-2">
                      <span className="font-medium">Reason:</span> {selectedLead.skipReason}
                    </p>
                  )}
                </div>
              </div>

              {selectedLead.calls.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Call History</h3>
                  <div className="space-y-2">
                    {selectedLead.calls.map((call) => (
                      <div key={call.id} className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-gray-700">
                          <span className="font-medium">Status:</span> {call.status}
                        </p>
                        {call.outcome && (
                          <p className="text-gray-700">
                            <span className="font-medium">Outcome:</span> {call.outcome}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="p-6 border-t border-gray-200">
              <button
                onClick={() => setSelectedLead(null)}
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
