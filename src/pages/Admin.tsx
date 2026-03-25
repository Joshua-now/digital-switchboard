import { useCallback, useEffect, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import {
  Building2, Users, RefreshCw, CheckCircle, XCircle,
  ChevronDown, ChevronRight, Phone, PhoneCall, UserCheck, ExternalLink, Search, Trash2,
} from 'lucide-react';

type AgencyClient = {
  id: string;
  name: string;
  status: string;
  _count: { leads: number; calls: number };
};

type Agency = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  _count: { users: number; clients: number };
  clients: AgencyClient[];
};

export default function Admin() {
  const { user } = useAuth();

  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

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

  if (user && user.role !== 'SUPER_ADMIN') {
    return <Navigate to="/clients" replace />;
  }

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

  const deleteAgency = async (agency: Agency) => {
    const confirmed = window.confirm(
      `Delete "${agency.name}"?\n\nThis permanently removes the agency, all its users, clients, leads, and calls. This cannot be undone.`
    );
    if (!confirmed) return;
    setDeleting(agency.id);
    try {
      await api.admin.agencies.delete(agency.id);
      setAgencies((prev) => prev.filter((a) => a.id !== agency.id));
    } catch (err: any) {
      alert(err?.message || 'Failed to delete agency');
    } finally {
      setDeleting(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filteredAgencies = search.trim()
    ? agencies.filter((a) =>
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.clients.some((c) => c.name.toLowerCase().includes(search.toLowerCase()))
      )
    : agencies;

  const totalClients = agencies.reduce((s, a) => s + a._count.clients, 0);
  const totalLeads = agencies.reduce(
    (s, a) => s + a.clients.reduce((cs, c) => cs + c._count.leads, 0), 0
  );
  const totalCalls = agencies.reduce(
    (s, a) => s + a.clients.reduce((cs, c) => cs + c._count.calls, 0), 0
  );
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
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search agencies or clients…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-64"
              />
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
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">

        {/* Stats row */}
        <div className="grid grid-cols-5 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-bold text-gray-900">{agencies.length}</div>
            <div className="text-sm text-gray-500 mt-0.5">Agencies</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-bold text-green-600">{activeCount}</div>
            <div className="text-sm text-gray-500 mt-0.5">Active</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-bold text-red-500">{suspendedCount}</div>
            <div className="text-sm text-gray-500 mt-0.5">Suspended</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-bold text-gray-900">{totalLeads}</div>
            <div className="text-sm text-gray-500 mt-0.5">Total Leads</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-bold text-gray-900">{totalCalls}</div>
            <div className="text-sm text-gray-500 mt-0.5">Total Calls</div>
          </div>
        </div>

        {/* Agency cards */}
        {loading && agencies.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
            Loading agencies…
          </div>
        ) : error ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-red-500 text-sm">
            {error}
          </div>
        ) : agencies.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
            No agencies yet. Contractors sign up at /signup.
          </div>
        ) : filteredAgencies.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
            No agencies match "{search}".
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAgencies.map((agency) => {
              const isOpen = expanded.has(agency.id);
              const agencyLeads = agency.clients.reduce((s, c) => s + c._count.leads, 0);
              const agencyCalls = agency.clients.reduce((s, c) => s + c._count.calls, 0);

              return (
                <div key={agency.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  {/* Agency header row */}
                  <div
                    className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => toggleExpand(agency.id)}
                  >
                    {/* Expand toggle */}
                    <div className="text-gray-400 flex-shrink-0">
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </div>

                    {/* Agency icon + name */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                        <Building2 size={16} className="text-blue-600" />
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">{agency.name}</div>
                        <div className="text-xs text-gray-400 font-mono">{agency.id.slice(0, 8)}…</div>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-6 text-sm text-gray-600">
                      <div className="flex items-center gap-1.5">
                        <Users size={13} className="text-gray-400" />
                        <span>{agency._count.users} user{agency._count.users !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <UserCheck size={13} className="text-gray-400" />
                        <span>{agency._count.clients} client{agency._count.clients !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Phone size={13} className="text-gray-400" />
                        <span>{agencyLeads} lead{agencyLeads !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <PhoneCall size={13} className="text-gray-400" />
                        <span>{agencyCalls} call{agencyCalls !== 1 ? 's' : ''}</span>
                      </div>
                    </div>

                    {/* Status badge */}
                    <div className="flex-shrink-0">
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
                    </div>

                    {/* View agency button */}
                    <Link
                      to={`/admin/agencies/${agency.id}`}
                      state={{ agencyName: agency.name }}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors flex-shrink-0"
                      title={`View ${agency.name}'s clients`}
                    >
                      <ExternalLink size={12} />
                      View
                    </Link>

                    {/* Suspend/Activate button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleStatus(agency); }}
                      disabled={toggling === agency.id}
                      className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0 ${
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

                    {/* Delete button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteAgency(agency); }}
                      disabled={deleting === agency.id}
                      className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-red-600 hover:bg-red-50 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                      title="Delete agency permanently"
                    >
                      {deleting === agency.id ? '…' : <Trash2 size={13} />}
                    </button>
                  </div>

                  {/* Expanded client list */}
                  {isOpen && (
                    <div className="border-t border-gray-100">
                      {agency.clients.length === 0 ? (
                        <div className="px-12 py-4 text-sm text-gray-400 italic">
                          No clients yet under this agency.
                        </div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-100">
                              <th className="text-left px-12 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wide">Client</th>
                              <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wide">Leads</th>
                              <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wide">Calls</th>
                              <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wide">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {agency.clients.map((client) => (
                              <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-12 py-3">
                                  <Link to={`/clients/${client.id}`} className="font-medium text-blue-600 hover:text-blue-700">
                                    {client.name}
                                  </Link>
                                </td>
                                <td className="px-4 py-3 text-gray-600">{client._count.leads}</td>
                                <td className="px-4 py-3 text-gray-600">{client._count.calls}</td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${
                                    client.status === 'ACTIVE'
                                      ? 'text-green-700 bg-green-50'
                                      : 'text-gray-500 bg-gray-100'
                                  }`}>
                                    {client.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
