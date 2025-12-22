const API_BASE = '/api';

interface FetchOptions extends RequestInit {
  token?: string;
}

async function fetchApi(endpoint: string, options: FetchOptions = {}) {
  const { token, ...fetchOptions } = options;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers || {}),
  };

  if (token) {
    (headers as any)['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...fetchOptions,
    headers,
    credentials: 'include', // 🔑 REQUIRED FOR LOGIN
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error((error as any).error || 'Request failed');
  }

  return response.json();
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      fetchApi('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),

    logout: () =>
      fetchApi('/auth/logout', {
        method: 'POST',
      }),

    me: () => fetchApi('/auth/me'),
  },

  clients: {
    list: (token: string) => fetchApi('/clients', { token }),
    get: (id: string, token: string) => fetchApi(`/clients/${id}`, { token }),
    create: (data: any, token: string) =>
      fetchApi('/clients', {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),
    update: (id: string, data: any, token: string) =>
      fetchApi(`/clients/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
        token,
      }),
    delete: (id: string, token: string) =>
      fetchApi(`/clients/${id}`, { method: 'DELETE', token }),
    getRoutingConfig: (id: string, token: string) =>
      fetchApi(`/clients/${id}/routing-config`, { token }),
    saveRoutingConfig: (id: string, data: any, token: string) =>
      fetchApi(`/clients/${id}/routing-config`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),
  },

  leads: {
    list: (
      params: { clientId?: string; limit?: number; offset?: number },
      token: string
    ) => {
      const query = new URLSearchParams();
      if (params.clientId) query.set('clientId', params.clientId);
      if (params.limit) query.set('limit', String(params.limit));
      if (params.offset) query.set('offset', String(params.offset));
      return fetchApi(`/leads?${query}`, { token });
    },
    get: (id: string, token: string) => fetchApi(`/leads/${id}`, { token }),
  },

  calls: {
    list: (
      params: { clientId?: string; limit?: number; offset?: number },
      token: string
    ) => {
      const query = new URLSearchParams();
      if (params.clientId) query.set('clientId', params.clientId);
      if (params.limit) query.set('limit', String(params.limit));
      if (params.offset) query.set('offset', String(params.offset));
      return fetchApi(`/calls?${query}`, { token });
    },
  },

  auditLogs: {
    list: (
      params: { clientId?: string; limit?: number; offset?: number },
      token: string
    ) => {
      const query = new URLSearchParams();
      if (params.clientId) query.set('clientId', params.clientId);
      if (params.limit) query.set('limit', String(params.limit));
      if (params.offset) query.set('offset', String(params.offset));
      return fetchApi(`/audit-logs?${query}`, { token });
    },
  },
};

export default api;
