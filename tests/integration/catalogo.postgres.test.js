import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { DatabaseService } = require('../../services/ms-catalogo/dist/database.js');
const { DatabaseService: PedidosDatabaseService } = require('../../services/ms-pedidos/dist/database.js');

test('Catálogo conserva stock e idempotencia en PostgreSQL efímero', { timeout: 90000 }, async () => {
  const name = `pedidos-integration-${randomUUID()}`;
  let container;
  let db;
  let pedidosDb;
  try {
    container = execFileSync('docker', ['run', '--rm', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD=prueba', '-p', '127.0.0.1::5432', 'postgres:16-alpine'], { encoding: 'utf8', timeout: 30000 }).trim();
    const mapping = execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8', timeout: 10000 }).trim();
    const port = Number(mapping.match(/:(\d+)\s*$/)?.[1]);
    assert.ok(port > 0, `Puerto inesperado: ${mapping}`);
    process.env.DATABASE_URL = `postgres://postgres:prueba@127.0.0.1:${port}/postgres`;
    db = new DatabaseService();
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try { await db.pool.query('SELECT 1'); ready = true; break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
    }
    assert.ok(ready, 'PostgreSQL efímero no inició');
    await db.onModuleInit();
    const branch = 'sucursal-centro'; const productId = 'producto-hamburguesa';
    const first = randomUUID(); const second = randomUUID();
    await db.reserveMany(first, branch, [{ productId, quantity: 15 }]);
    await assert.rejects(() => db.reserveMany(second, branch, [{ productId, quantity: 10 }]), /Stock insuficiente/);
    await db.reserveMany(first, branch, [{ productId, quantity: 15 }]);
    let item = (await db.listMenu(branch)).find((row) => row.id === productId);
    assert.equal(item.availableStock, 5);
    await db.transitionReservation(first, 'liberada');
    await db.transitionReservation(first, 'liberada');
    item = (await db.listMenu(branch)).find((row) => row.id === productId);
    assert.equal(item.availableStock, 20);
    await db.reserveMany(second, branch, [{ productId, quantity: 10 }]);
    await db.transitionReservation(second, 'consolidada');
    item = (await db.listMenu(branch)).find((row) => row.id === productId);
    assert.equal(item.stockTotal, 10);
    assert.equal(item.availableStock, 10);

    await db.pool.query('CREATE DATABASE pedidos_integration');
    process.env.DATABASE_URL = `postgres://postgres:prueba@127.0.0.1:${port}/pedidos_integration`;
    pedidosDb = new PedidosDatabaseService();
    await pedidosDb.onModuleInit();
    const sameKey = randomUUID(); const clientId = randomUUID();
    const base = { clientId, branchId: branch, paymentToken: 'tok_prueba', correlationId: randomUUID(), items: [{ productId, quantity: 1 }], totalCents: 1, currency: 'BOB', requestHash: 'misma-solicitud', idempotencyKey: sameKey };
    const [a, b] = await Promise.all([pedidosDb.createOrder({ ...base, id: randomUUID() }), pedidosDb.createOrder({ ...base, id: randomUUID() })]);
    assert.equal(a.orderId, b.orderId);
    assert.notEqual(a.existing, b.existing);
    const count = await pedidosDb.pool.query('SELECT count(*)::int AS total FROM orders');
    assert.equal(count.rows[0].total, 1);
    await pedidosDb.createReversalEvent(a.orderId, 'operacion-pasarela', 3500, 'BOB', base.correlationId);
    await pedidosDb.createReversalEvent(a.orderId, 'operacion-pasarela', 3500, 'BOB', base.correlationId);
    const reversalCount = await pedidosDb.pool.query("SELECT count(*)::int AS total FROM outbox WHERE aggregate_id=$1 AND event_type='ReversionSolicitada'", [a.orderId]);
    assert.equal(reversalCount.rows[0].total, 1);
  } finally {
    if (pedidosDb) await pedidosDb.onModuleDestroy();
    if (db) await db.onModuleDestroy();
    if (container) execFileSync('docker', ['stop', container], { encoding: 'utf8', timeout: 20000 });
    delete process.env.DATABASE_URL;
  }
});
