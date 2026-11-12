import test, { before } from 'node:test';
import assert from 'node:assert/strict';

const auth = process.env.MS_AUTH_URL ?? 'http://localhost:3005';
const catalogo = process.env.MS_CATALOGO_URL ?? 'http://localhost:3001';
const pedidos = process.env.MS_PEDIDOS_URL ?? 'http://localhost:3002';
let token = process.env.E2E_TOKEN;
const enabled = process.env.RUN_E2E === '1';
let branch;
let menu;

async function call(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${url} respondió ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

before(async () => {
  if (!enabled) return;
  if (!token) {
    const response = await fetch(`${auth}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.E2E_EMAIL ?? 'cliente@demo.local', password: process.env.E2E_PASSWORD ?? 'cliente123' }) });
    const body = await response.json();
    assert.ok(response.ok, `${auth} login respondió ${response.status}: ${JSON.stringify(body)}`);
    token = body.accessToken;
  }
  const branches = await call(`${catalogo}/v1/sucursales`);
  branch = branches[0];
  menu = await call(`${catalogo}/v1/sucursales/${branch.id}/menu`);
  assert.ok(menu.length > 0);
});

test('E2E pedido confirmado', { skip: !enabled }, async () => {
  const item = menu.find((candidate) => candidate.availableStock > 0);
  const before = (await call(`${catalogo}/v1/sucursales/${branch.id}/menu`)).find((candidate) => candidate.id === item.id).availableStock;
  const created = await call(`${pedidos}/v1/pedidos`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ branchId: branch.id, items: [{ productId: item.id, quantity: 1 }], paymentToken: 'tok_e2e_aprobado' }) });
  let current = created;
  const until = Date.now() + 15000;
  while (current.status === 'pendiente' && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 500)); current = await call(`${pedidos}/v1/pedidos/${created.id}`); }
  assert.equal(current.status, 'confirmado');
  assert.ok(current.history.some((entry) => entry.toStatus === 'confirmado'));
  const after = (await call(`${catalogo}/v1/sucursales/${branch.id}/menu`)).find((candidate) => candidate.id === item.id).availableStock;
  assert.equal(after, before - 1);
});

test('E2E pedido compensado por rechazo de pasarela', { skip: !enabled }, async () => {
  const item = menu.find((candidate) => candidate.availableStock > 0);
  const before = (await call(`${catalogo}/v1/sucursales/${branch.id}/menu`)).find((candidate) => candidate.id === item.id).availableStock;
  const created = await call(`${pedidos}/v1/pedidos`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ branchId: branch.id, items: [{ productId: item.id, quantity: 1 }], paymentToken: 'tok_reject' }) });
  let current = created;
  const until = Date.now() + 15000;
  while (current.status === 'pendiente' && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 500)); current = await call(`${pedidos}/v1/pedidos/${created.id}`); }
  assert.equal(current.status, 'rechazado');
  assert.ok(current.history.some((entry) => entry.reason.toLowerCase().includes('rechaz')));
  const after = (await call(`${catalogo}/v1/sucursales/${branch.id}/menu`)).find((candidate) => candidate.id === item.id).availableStock;
  assert.equal(after, before);
});

test('E2E circuito abierto: rechazo con motivo y stock liberado', { skip: !enabled }, async () => {
  const item = menu.find((candidate) => candidate.availableStock > 0);
  const before = (await call(`${catalogo}/v1/sucursales/${branch.id}/menu`)).find((candidate) => candidate.id === item.id).availableStock;
  const created = await call(`${pedidos}/v1/pedidos`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ branchId: branch.id, items: [{ productId: item.id, quantity: 1 }], paymentToken: 'tok_error' }) });
  let current = created;
  const until = Date.now() + 15000;
  while (current.status === 'pendiente' && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 500)); current = await call(`${pedidos}/v1/pedidos/${created.id}`); }
  assert.equal(current.status, 'rechazado');
  assert.match(current.rejectionReason, /circuit breaker abierto/i);
  const after = (await call(`${catalogo}/v1/sucursales/${branch.id}/menu`)).find((candidate) => candidate.id === item.id).availableStock;
  assert.equal(after, before);
});

test('E2E stock insuficiente: no cobra y conserva existencias', { skip: !enabled }, async () => {
  const item = menu[0];
  const before = (await call(`${catalogo}/v1/sucursales/${branch.id}/menu`)).find((candidate) => candidate.id === item.id).availableStock;
  const created = await call(`${pedidos}/v1/pedidos`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ branchId: branch.id, items: [{ productId: item.id, quantity: before + 1 }], paymentToken: 'tok_e2e_aprobado' }) });
  let current = created;
  const until = Date.now() + 10000;
  while (current.status === 'pendiente' && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 500)); current = await call(`${pedidos}/v1/pedidos/${created.id}`); }
  assert.equal(current.status, 'rechazado');
  assert.match(current.rejectionReason, /stock insuficiente/i);
  const after = (await call(`${catalogo}/v1/sucursales/${branch.id}/menu`)).find((candidate) => candidate.id === item.id).availableStock;
  assert.equal(after, before);
});
