// src/lib/api.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiErrorShape = {
  error?: string;
  message?: string;
  details?: any;
};

export class ApiError extends Error {
  status: number;
  data?: ApiErrorShape | any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

/**
 * Base URL strategy:
 * - In dev, Vite proxy routes /api -> backend :3000, so we can call relative paths.
 * - In prod (Railway), the backend typically serves the same origin, so relative paths still work.
 *
 * If you ever want to force an absolute API origin, set:
 *   VITE_API_ORIGIN=https://your-domain.com
 * and this file will prefix requests with it.
 */
const API_ORIGIN = (import.meta as any).env?.VITE_API_ORIGIN?.toString()?.trim() || "";
const withOrigin = (path: string) => {
  if (!API_ORIGIN) return path;
  // Ensure we don't double-prefix
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_ORIGIN}${path.startsWith("/") ? "" : "/"}${path}`;
};

function isJsonResponse(res: Response) {
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json");
}

/**
 * Core fetch wrapper. Always includes credentials so cookie-based auth works.
 */
async function fetchApi<T>(
  path: string,
  options: {
    method?: HttpMethod;
    body?: any;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    ...(options.headers || {}),
  };

  let body: BodyInit | undefined;

  if (options.body !== undefined) {
    // If it's already FormData, let the browser set the content-type boundary.
    if (options.body instanceof FormData) {
      body = options.body;
    } else {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      body = headers["Content-Type"].includes("application/json")
        ? JSON.stringify(options.body)
        : (options.body as BodyInit);
    }
  }

  const url = withOrigin(path);

  const res = await fetch(url, {
    method,
    headers,
    body,
    signal: options.signal,
    credentials: "include", // IMPORTANT for cookie/session auth
  });

  let data: any = null;
  try {
    if (isJsonResponse(res)) {
      data = await res.json();
    } else {
      data = await res.text();
    }
  } catch {
    // ignore parse errors
  }

  if (!res.ok) {
    const msg =
      (data && (data.error || data.message)) ||
      `Request failed (${res.status})`;

    // 401 on any non-auth endpoint → stale/invalid token → force re-login
    if (res.status === 401 && !path.includes('/auth/')) {
      const isAuthPage = window.location.pathname === '/login' || window.location.pathname === '/signup';
      if (!isAuthPage) {
        window.location.href = '/login';
      }
    }

    throw new ApiError(msg, res.status, data);
  }

  return data as T;
}

/**
 * Optional helper for "no body" responses.
 */
async function fetchNoBody(
  path: string,
  options: { method?: HttpMethod; headers?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<void> {
  await fetchApi<unknown>(path, options);
}

/**
 * Public API surface used throughout the app.
 *
 * NOTE: The key fix vs your current setup:
 *   - auth endpoints are /api/auth/* (NOT /auth/*)
 * This matches the endpoint you confirmed is working:
 *   GET /api/auth/me
 */
export const api = {
  // Convenience low-level methods if you want them elsewhere
  http: {
    get: <T>(path: string, signal?: AbortSignal) => fetchApi<T>(path, { method: "GET", signal }),
    post: <T>(path: string, body?: any, signal?: AbortSignal) =>
      fetchApi<T>(path, { method: "POST", body, signal }),
    put: <T>(path: string, body?: any, signal?: AbortSignal) =>
      fetchApi<T>(path, { method: "PUT", body, signal }),
    patch: <T>(path: string, body?: any, signal?: AbortSignal) =>
      fetchApi<T>(path, { method: "PATCH", body, signal }),
    del: <T>(path: string, signal?: AbortSignal) => fetchApi<T>(path, { method: "DELETE", signal }),
  },

  auth: {
    me: () =>
      fetchApi<{
        user: {
          email: string;
          name: string | null;
          role: 'SUPER_ADMIN' | 'AGENCY_ADMIN';
          agencyId: string | null;
          agencyName: string | null;
        };
      }>("/api/auth/me"),

    login: (email: string, password: string) =>
      fetchApi<{
        success: boolean;
        user: {
          email: string;
          name: string | null;
          role: 'SUPER_ADMIN' | 'AGENCY_ADMIN';
          agencyId: string | null;
          agencyName: string | null;
        };
      }>("/api/auth/login", {
        method: "POST",
        body: { email, password },
      }),

    signup: (agencyName: string, name: string, email: string, password: string) =>
      fetchApi<{
        success: boolean;
        user: {
          email: string;
          name: string | null;
          role: 'SUPER_ADMIN' | 'AGENCY_ADMIN';
          agencyId: string | null;
          agencyName: string | null;
        };
      }>("/api/auth/signup", {
        method: "POST",
        body: { agencyName, name, email, password },
      }),

    logout: () => fetchNoBody("/api/auth/logout", { method: "POST" }),
  },

  /**
   * Super-admin agency management
   */
  admin: {
    agencies: {
      list: () =>
        fetchApi<{
          id: string;
          name: string;
          status: 'ACTIVE' | 'SUSPENDED';
          createdAt: string;
          _count: { users: number; clients: number };
        }[]>("/api/admin/agencies"),
      update: (id: string, data: { status: 'ACTIVE' | 'SUSPENDED' }) =>
        fetchApi<any>(`/api/admin/agencies/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: data,
        }),
      delete: (id: string) =>
        fetchApi<{ success: boolean }>(`/api/admin/agencies/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
    },
  },

  /**
   * Health endpoint (you already have a dev proxy for /health).
   * If your backend exposes /health directly (not under /api), keep as-is.
   * If your backend exposes /api/health instead, change this to "/api/health".
   */
  health: () =>
    fetchApi<{ status: string; timestamp?: string; database?: string }>("/health"),

  /**
   * Webhook endpoints (you already proxy /webhook -> backend).
   * Keep relative so it works in dev + prod.
   */
  webhook: {
    post: <T = any>(path: string, body?: any) =>
      fetchApi<T>(`/webhook${path.startsWith("/") ? "" : "/"}${path}`, {
        method: "POST",
        body,
      }),
  },

  /**
   * Clients API
   */
  clients: {
    list: (options?: string | { agencyId?: string }) => {
      const token = typeof options === 'string' ? options : undefined;
      const agencyId = typeof options !== 'string' ? options?.agencyId : undefined;
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const query = new URLSearchParams();
      if (agencyId) query.set('agencyId', agencyId);
      const qs = query.toString();
      return fetchApi<any[]>(`/api/clients${qs ? '?' + qs : ''}`, { headers });
    },
    get: (id: string, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      return fetchApi<any>(`/api/clients/${encodeURIComponent(id)}`, { headers });
    },
    create: (payload: any, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      return fetchApi<any>("/api/clients", { method: "POST", body: payload, headers });
    },
    update: (id: string, payload: any, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      return fetchApi<any>(`/api/clients/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: payload,
        headers,
      });
    },
    delete: (id: string, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      return fetchNoBody(`/api/clients/${encodeURIComponent(id)}`, { method: "DELETE", headers });
    },
    getRoutingConfig: (id: string, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      return fetchApi<any>(`/api/clients/${encodeURIComponent(id)}/routing`, { headers });
    },
    saveRoutingConfig: (id: string, payload: any, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      return fetchApi<any>(`/api/clients/${encodeURIComponent(id)}/routing`, {
        method: "POST",
        body: payload,
        headers,
      });
    },
    // ── Multi-campaign routing configs ──
    listRoutingConfigs: (clientId: string) =>
      fetchApi<any[]>(`/api/clients/${encodeURIComponent(clientId)}/routing-configs`),
    createRoutingConfig: (clientId: string, payload: any) =>
      fetchApi<any>(`/api/clients/${encodeURIComponent(clientId)}/routing-configs`, {
        method: "POST",
        body: payload,
      }),
    updateRoutingConfig: (clientId: string, configId: string, payload: any) =>
      fetchApi<any>(`/api/clients/${encodeURIComponent(clientId)}/routing-configs/${encodeURIComponent(configId)}`, {
        method: "PUT",
        body: payload,
      }),
    deleteRoutingConfig: (clientId: string, configId: string) =>
      fetchApi<any>(`/api/clients/${encodeURIComponent(clientId)}/routing-configs/${encodeURIComponent(configId)}`, {
        method: "DELETE",
      }),
  },

  /**
   * Leads API
   */
  leads: {
    list: (params?: { clientId?: string; limit?: number; offset?: number; search?: string; status?: string }, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const query = new URLSearchParams();
      if (params?.clientId) query.set('clientId', params.clientId);
      if (params?.limit) query.set('limit', params.limit.toString());
      if (params?.offset !== undefined) query.set('offset', params.offset.toString());
      if (params?.search) query.set('search', params.search);
      if (params?.status) query.set('status', params.status);
      const queryString = query.toString();
      return fetchApi<{ leads: any[]; total: number }>(
        `/api/leads${queryString ? '?' + queryString : ''}`,
        { headers }
      );
    },
    get: (id: string, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      return fetchApi<any>(`/api/leads/${encodeURIComponent(id)}`, { headers });
    },
    create: (payload: any, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      return fetchApi<any>("/api/leads", { method: "POST", body: payload, headers });
    },
    update: (id: string, payload: any, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      return fetchApi<any>(`/api/leads/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: payload,
        headers,
      });
    },
    delete: (id: string, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      return fetchNoBody(`/api/leads/${encodeURIComponent(id)}`, { method: "DELETE", headers });
    },
  },

  /**
   * Calls API
   */
  calls: {
    list: (params?: { clientId?: string; limit?: number; offset?: number; status?: string }, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const query = new URLSearchParams();
      if (params?.clientId) query.set('clientId', params.clientId);
      if (params?.limit) query.set('limit', params.limit.toString());
      if (params?.offset !== undefined) query.set('offset', params.offset.toString());
      if (params?.status) query.set('status', params.status);
      const queryString = query.toString();
      return fetchApi<{ calls: any[]; total: number }>(
        `/api/calls${queryString ? '?' + queryString : ''}`,
        { headers }
      );
    },
    get: (id: string, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      return fetchApi<any>(`/api/calls/${encodeURIComponent(id)}`, { headers });
    },
    create: (payload: any, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      return fetchApi<any>("/api/calls", { method: "POST", body: payload, headers });
    },
    update: (id: string, payload: any, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      return fetchApi<any>(`/api/calls/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: payload,
        headers,
      });
    },
    delete: (id: string, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      return fetchNoBody(`/api/calls/${encodeURIComponent(id)}`, { method: "DELETE", headers });
    },
  },
};

export default api;
