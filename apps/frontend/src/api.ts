export type Branch = { id: string; name: string; address: string };
export type MenuItem = { id: string; name: string; description: string; priceCents: number; currency: string; stockTotal: number; availableStock: number };
export type Order = { id: string; branchId: string; status: string; internalStatus: string; totalCents: number; currency: string; rejectionReason?: string; correlationId: string; createdAt: string; updatedAt: string; items: Array<{ productId: string; quantity: number; unitPriceCents: number | null }>; history: Array<{ fromStatus?: string; toStatus: string; reason: string; createdAt: string }> };
export type OrderSummary = { id: string; branchId: string; status: string; internalStatus: string; totalCents: number; currency: string; rejectionReason?: string; createdAt: string; updatedAt: string; itemCount: number };
export type Session = { accessToken: string; refreshToken: string; tokenType: string; expiresIn: string; user: { id: string; email: string; role: string; branchId?: string } };

const authUrl = import.meta.env.VITE_MS_AUTH_URL ?? 'http://localhost:3005';
const catalogoUrl = import.meta.env.VITE_MS_CATALOGO_URL ?? 'http://localhost:3001';
const pedidosUrl = import.meta.env.VITE_MS_PEDIDOS_URL ?? 'http://localhost:3002';

function responseError(body: any, status: number) {
  const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message ?? body?.error ?? `Error HTTP ${status}`;
  const hint = status === 401 ? '. La sesión expiró; cierra sesión e inicia sesión nuevamente' : '';
  return `${message}${hint} (HTTP ${status})`;
}

async function call<T>(base: string, path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(responseError(body, response.status));
  return body as T;
}

async function publicCall<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(responseError(body, response.status));
  return body as T;
}

export const api = {
  login: (email: string, password: string) => publicCall<Session>(authUrl, '/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string) => publicCall<Session>(authUrl, '/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: (refreshToken: string) => publicCall<{ loggedOut: boolean }>(authUrl, '/v1/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  branches: (token: string) => call<Branch[]>(catalogoUrl, '/v1/sucursales', token),
  menu: (token: string, branchId: string) => call<MenuItem[]>(catalogoUrl, `/v1/sucursales/${branchId}/menu`, token),
  createOrder: (token: string, body: unknown, key: string) => call<Order>(pedidosUrl, '/v1/pedidos', token, { method: 'POST', headers: { 'idempotency-key': key }, body: JSON.stringify(body) }),
  orders: (token: string) => call<OrderSummary[]>(pedidosUrl, '/v1/pedidos', token),
  order: (token: string, orderId: string) => call<Order>(pedidosUrl, `/v1/pedidos/${encodeURIComponent(orderId.trim())}`, token),
  saveProduct: (token: string, branchId: string, body: unknown) => call(catalogoUrl, `/v1/sucursales/${branchId}/productos`, token, { method: 'POST', body: JSON.stringify(body) }),
};

export function decodeRole(token: string) {
  try { const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return payload as { sub: string; role: string; branchId?: string }; } catch { return undefined; }
}

export function money(cents: number, currency = 'BOB') { return new Intl.NumberFormat('es-BO', { style: 'currency', currency }).format(cents / 100); }
