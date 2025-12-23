const API_BASE = '/api';

type FetchApiOptions = RequestInit & {
  token?: string | null;
};

async function fetchApi<T = any>(endpoint: string, options: FetchApiOptions = {}): Promise<T> {
  const { token, ...fetchOptions } = options;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers || {}),
  };

  // Optional bearer support (keep it, but cookies are primary)
  if (token) {
    (headers as any).Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...fetchOptions,
    headers,
    credentials: 'include', // IMPORTANT: sends cookie
  });

  // Try to parse JSON either way
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = (data as any)?.error || `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      fetchApi<{ success: boolean; token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),

    logout: () =>
      fetchApi<{ success: boolean }>('/auth/logout', {
        method: 'POST',
      }),

    me: () => fetchApi<{ user: { email: string; isAdmin: boolean } }>('/auth/me'),
  },

  clients: {
    list: () => fetchApi('/clients'),
    get: (id: string) => fetchApi(`/clients/${id}`),
    create: (body: any) =>
      fetchApi('/clients', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: any) =>
      fetchApi(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: string) => fetchApi(`/clients/${id}`, { method: 'DELETE' }),
    getRoutingConfig: (id: string) => fetchApi(`/clients/${id}/routing-config`),
    saveRoutingConfig: (id: string, body: any) =>
      fetchApi(`/clients/${id}/routing-config`, { method: 'POST', body: JSON.stringify(body) }),
  },

  leads: {
    list: (params: { clientId?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params.clientId) q.set('clientId', params.clientId);
      if (params.limit) q.set('limit', String(params.limit));
      if (params.offset) q.set('offset', String(params.offset));
      return fetchApi(`/leads?${q.toString()}`);
    },
    get: (id: string) => fetchApi(`/leads/${id}`),
  },

  calls: {
    list: (params: { clientId?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params.clientId) q.set('clientId', params.clientId);
      if (params.limit) q.set('limit', String(params.limit));
      if (params.offset) q.set('offset', String(params.offset));
      return fetchApi(`/calls?${q.toString()}`);
    },
  },

  auditLogs: {
    list: (params: { clientId?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params.clientId) q.set('clientId', params.clientId);
      if (params.limit) q.set('limit', String(params.limit));
      if (params.offset) q.set('offset', String(params.offset));
      return fetchApi(`/audit-logs?${q.toString()}`);
    },
  },
};
