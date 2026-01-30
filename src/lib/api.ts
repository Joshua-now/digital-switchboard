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
    /**
     * Returns the currently authenticated user/session.
     * Your confirmed working response shape:
     * { user: { email, isAdmin, iat, exp } }
     */
    me: () =>
      fetchApi<{
        user: {
          email: string;
          isAdmin: boolean;
          iat?: number;
          exp?: number;
          [k: string]: any;
        };
      }>("/api/auth/me"),

    /**
     * Login with email/password.
     * Adjust response shape if your backend returns something else.
     */
    login: (email: string, password: string) =>
      fetchApi<{
        success?: boolean;
        user?: { email: string; isAdmin: boolean; [k: string]: any };
        [k: string]: any;
      }>("/api/auth/login", {
        method: "POST",
        body: { email, password },
      }),

    /**
     * Logout / clear session cookie.
     */
    logout: () => fetchNoBody("/api/auth/logout", { method: "POST" }),
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
    list: (token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      return fetchApi<any[]>("/api/clients", { headers });
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
  },

  /**
   * Leads API
   */
  leads: {
    list: (params?: { clientId?: string; limit?: number }, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const query = new URLSearchParams();
      if (params?.clientId) query.set('clientId', params.clientId);
      if (params?.limit) query.set('limit', params.limit.toString());
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
    list: (params?: { clientId?: string; limit?: number }, token?: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const query = new URLSearchParams();
      if (params?.clientId) query.set('clientId', params.clientId);
      if (params?.limit) query.set('limit', params.limit.toString());
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
