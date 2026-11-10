import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type NewOrder = { id: string; clientId: string; branchId: string; paymentToken: string; correlationId: string; items: Array<{ productId: string; quantity: number }>; totalCents: number; currency: string; requestHash: string; idempotencyKey: string };
export type EventRecord = { eventId: string; eventType: string; schemaVersion: string; orderId: string; correlationId: string; occurredAt: string; payload: Record<string, unknown> };
export type OrderScope = { clientId?: string; branchId?: string };

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://pedidos:pedidos@localhost:5432/pedidos_db' });
  private ready: Promise<void> = Promise.resolve();
  async onModuleInit() {
    this.ready = this.migrate();
    return this.ready;
  }
  private async migrate() {
    const dirs = [resolve(process.cwd(), 'migrations'), resolve(process.cwd(), 'services/ms-pedidos/migrations'), join(__dirname, '../migrations')];
    const dir = dirs.find((path) => existsSync(path));
    if (!dir) throw new Error('No se encontró la carpeta de migraciones de Pedidos');
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) await this.pool.query(readFileSync(join(dir, file), 'utf8'));
  }
  async waitReady() { await this.ready; }
  async onModuleDestroy() { await this.pool.end(); }
  async tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> { const client = await this.pool.connect(); try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } }

  async createOrder(order: NewOrder) {
    return this.tx(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [order.clientId, order.idempotencyKey]);
      const existing = await client.query('SELECT request_hash AS "requestHash", order_id AS "orderId" FROM idempotency_keys WHERE client_id=$1 AND key=$2', [order.clientId, order.idempotencyKey]);
      if (existing.rows[0]) return { existing: true, ...existing.rows[0] };
      await client.query(`INSERT INTO orders(id, client_id, branch_id, status, internal_status, total_cents, currency, payment_token, correlation_id)
        VALUES($1,$2,$3,'pendiente','reservando',$4,$5,$6,$7)`, [order.id, order.clientId, order.branchId, order.totalCents, order.currency, order.paymentToken, order.correlationId]);
      for (const item of order.items) await client.query('INSERT INTO order_items(order_id, product_id, quantity) VALUES($1,$2,$3)', [order.id, item.productId, item.quantity]);
      await client.query('INSERT INTO order_transitions(order_id, from_status, to_status, reason, correlation_id) VALUES($1,NULL,\'pendiente\',$2,$3)', [order.id, 'Pedido recibido', order.correlationId]);
      await client.query('INSERT INTO sagas(order_id, step) VALUES($1,\'reservando\')', [order.id]);
      await client.query('INSERT INTO idempotency_keys(client_id,key,request_hash,order_id) VALUES($1,$2,$3,$4)', [order.clientId, order.idempotencyKey, order.requestHash, order.id]);
      return { existing: false, orderId: order.id };
    });
  }

  async getOrder(orderId: string, scope?: OrderScope) {
    const params: string[] = [orderId];
    let where = 'o.id=$1';
    if (scope?.clientId) { params.push(scope.clientId); where += ' AND o.client_id=$2'; }
    if (scope?.branchId) { params.push(scope.branchId); where += ` AND o.branch_id=$${params.length}`; }
    const order = await this.pool.query(`SELECT o.id, o.client_id AS "clientId", o.branch_id AS "branchId", o.status, o.internal_status AS "internalStatus", o.total_cents AS "totalCents", o.currency, o.rejection_reason AS "rejectionReason", o.correlation_id AS "correlationId", o.created_at AS "createdAt", o.updated_at AS "updatedAt" FROM orders o WHERE ${where}`, params);
    if (!order.rows[0]) return undefined;
    const items = await this.pool.query('SELECT product_id AS "productId", quantity, name, unit_price_cents AS "unitPriceCents" FROM order_items WHERE order_id=$1 ORDER BY product_id', [orderId]);
    const history = await this.pool.query('SELECT from_status AS "fromStatus", to_status AS "toStatus", reason, correlation_id AS "correlationId", created_at AS "createdAt" FROM order_transitions WHERE order_id=$1 ORDER BY id', [orderId]);
    return { ...order.rows[0], items: items.rows, history: history.rows };
  }

  async listOrders(scope: OrderScope) {
    const params: string[] = [];
    let where = 'TRUE';
    if (scope.clientId) { params.push(scope.clientId); where = 'o.client_id=$1'; }
    if (scope.branchId) { params.push(scope.branchId); where = `o.branch_id=$${params.length}`; }
    const { rows } = await this.pool.query(`
      SELECT o.id, o.branch_id AS "branchId", o.status, o.internal_status AS "internalStatus",
             o.total_cents AS "totalCents", o.currency, o.rejection_reason AS "rejectionReason",
             o.created_at AS "createdAt", o.updated_at AS "updatedAt",
             COUNT(oi.product_id)::int AS "itemCount"
      FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id
      WHERE ${where}
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 100`, params);
    return rows;
  }

  async getOrderForSaga(orderId: string) { const result = await this.pool.query('SELECT * FROM orders WHERE id=$1', [orderId]); return result.rows[0]; }
  async pendingReservations() { await this.waitReady(); const result = await this.pool.query("SELECT id FROM orders WHERE status='pendiente' AND internal_status='reservando' ORDER BY created_at LIMIT 50"); return result.rows.map((row) => String(row.id)); }
  async getOrderItems(orderId: string) { const result = await this.pool.query('SELECT product_id AS "productId", quantity FROM order_items WHERE order_id=$1 ORDER BY product_id', [orderId]); return result.rows; }

  async saveReservation(orderId: string, reservationId: string, totalCents: number, items: Array<{ productId: string; quantity: number; priceCents: number }>) {
    return this.tx(async (client) => {
      await client.query('UPDATE orders SET total_cents=$2, internal_status=\'esperando_pago\', updated_at=now() WHERE id=$1', [orderId, totalCents]);
      for (const item of items) await client.query('UPDATE order_items SET unit_price_cents=$3 WHERE order_id=$1 AND product_id=$2', [orderId, item.productId, item.priceCents]);
      await client.query('UPDATE sagas SET reservation_id=$2, step=\'esperando_pago\', last_error=NULL, updated_at=now() WHERE order_id=$1', [orderId, reservationId]);
      const context = await this.orderContext(client, orderId);
      const event = this.envelope(orderId, 'CobroSolicitado', context.correlationId, { paymentToken: await this.paymentToken(client, orderId), amountCents: totalCents, currency: context.currency });
      await client.query('INSERT INTO outbox(id,topic,event_key,event_type,aggregate_id,payload) VALUES($1,$2,$3,$4,$5,$6)', [event.eventId, process.env.KAFKA_COMMAND_TOPIC ?? 'payments.commands.v1', orderId, event.eventType, orderId, event]);
      return event;
    });
  }

  private async paymentToken(client: PoolClient, orderId: string) { const result = await client.query('SELECT payment_token FROM orders WHERE id=$1', [orderId]); return result.rows[0].payment_token; }
  private async orderContext(client: PoolClient, orderId: string) { const result = await client.query('SELECT correlation_id AS "correlationId", currency FROM orders WHERE id=$1', [orderId]); return result.rows[0]; }
  private envelope(orderId: string, eventType: string, correlationId: string, payload: Record<string, unknown>): EventRecord { return { eventId: crypto.randomUUID(), eventType, schemaVersion: '1', orderId, correlationId, occurredAt: new Date().toISOString(), payload }; }

  async transition(orderId: string, toStatus: string, internalStatus: string, reason: string, correlationId: string) {
    return this.tx(async (client) => {
      const current = await client.query('SELECT status FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      if (!current.rows[0]) throw new Error('Pedido inexistente');
      if (current.rows[0].status === toStatus && internalStatus === 'finalizado') return;
      await client.query('UPDATE orders SET status=$2, internal_status=$3, rejection_reason=$4, updated_at=now() WHERE id=$1', [orderId, toStatus, internalStatus, toStatus === 'rechazado' ? reason : null]);
      await client.query('INSERT INTO order_transitions(order_id,from_status,to_status,reason,correlation_id) VALUES($1,$2,$3,$4,$5)', [orderId, current.rows[0].status, toStatus, reason, correlationId]);
      await client.query('UPDATE sagas SET step=$2,last_error=$3,updated_at=now() WHERE order_id=$1', [orderId, internalStatus, toStatus === 'rechazado' ? reason : null]);
    });
  }

  async markSaga(orderId: string, step: string, error?: string) {
    await this.tx(async (client) => {
      await client.query("UPDATE orders SET internal_status=$2, updated_at=now() WHERE id=$1 AND status='pendiente'", [orderId, step]);
      await client.query('UPDATE sagas SET step=$2,last_error=$3,updated_at=now() WHERE order_id=$1', [orderId, step, error ?? null]);
    });
  }
  async addOutbox(event: EventRecord, topic = process.env.KAFKA_COMMAND_TOPIC ?? 'payments.commands.v1') { await this.pool.query('INSERT INTO outbox(id,topic,event_key,event_type,aggregate_id,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [event.eventId, topic, event.orderId, event.eventType, event.orderId, event]); }
  async pendingOutbox(limit = 50) { await this.waitReady(); const result = await this.pool.query('SELECT id,topic,event_key,payload FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT $1', [limit]); return result.rows; }
  async markOutbox(id: string) { await this.pool.query('UPDATE outbox SET published_at=now(), attempts=attempts+1 WHERE id=$1', [id]); }
  async failOutbox(id: string) { await this.pool.query('UPDATE outbox SET attempts=attempts+1 WHERE id=$1', [id]); }

  async processPaymentResult(event: EventRecord, apply: () => Promise<void>) {
    const existing = await this.pool.query('SELECT event_id FROM inbox WHERE event_id=$1', [event.eventId]);
    if (existing.rows[0]) return { duplicate: true };
    await apply();
    await this.pool.query('INSERT INTO inbox(event_id,event_type,result) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [event.eventId, event.eventType, event]);
    return { duplicate: false };
  }

  async createReversalEvent(orderId: string, paymentId: string, amountCents: number, currency: string, correlationId: string) {
    const event = this.envelope(orderId, 'ReversionSolicitada', correlationId, { paymentId, amountCents, currency });
    await this.tx(async (client) => {
      await client.query('INSERT INTO outbox(id,topic,event_key,event_type,aggregate_id,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [event.eventId, process.env.KAFKA_COMMAND_TOPIC ?? 'payments.commands.v1', orderId, event.eventType, orderId, event]);
      await client.query("UPDATE orders SET internal_status='revirtiendo_pago', updated_at=now() WHERE id=$1", [orderId]);
      await client.query("UPDATE sagas SET step='revirtiendo_pago', updated_at=now() WHERE order_id=$1", [orderId]);
    });
    return event;
  }
}
