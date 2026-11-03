import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type PaymentEvent = { eventId: string; eventType: string; schemaVersion: string; orderId: string; correlationId: string; occurredAt: string; payload: Record<string, unknown> };

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://pagos:pagos@localhost:5432/pagos_db' });
  private ready: Promise<void> = Promise.resolve();
  async onModuleInit() { this.ready = this.migrate(); return this.ready; }
  private async migrate() { const dirs = [resolve(process.cwd(), 'migrations'), resolve(process.cwd(), 'services/ms-pagos/migrations'), join(__dirname, '../migrations')]; const dir = dirs.find((path) => existsSync(path)); if (!dir) throw new Error('No se encontró la carpeta de migraciones de ms-pagos'); for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) await this.pool.query(readFileSync(join(dir, file), 'utf8')); }
  async waitReady() { await this.ready; }
  async onModuleDestroy() { await this.pool.end(); }
  async tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> { const client = await this.pool.connect(); try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } }

  async getTransaction(orderId: string) { const result = await this.pool.query('SELECT order_id AS "orderId", payment_id AS "paymentId", status, amount_cents AS "amountCents", currency, correlation_id AS "correlationId", reason, result_event AS "resultEvent" FROM payment_transactions WHERE order_id=$1', [orderId]); return result.rows[0]; }
  async pendingReversals() { await this.waitReady(); const result = await this.pool.query("SELECT order_id AS \"orderId\", payment_id AS \"paymentId\", amount_cents AS \"amountCents\", currency, correlation_id AS \"correlationId\" FROM payment_transactions WHERE status='reversion_pendiente' ORDER BY updated_at LIMIT 50"); return result.rows; }
  async startTransaction(orderId: string, paymentId: string, amountCents: number, currency: string, correlationId: string) { await this.pool.query(`INSERT INTO payment_transactions(order_id,payment_id,status,amount_cents,currency,correlation_id) VALUES($1,$2,'pendiente',$3,$4,$5) ON CONFLICT(order_id) DO NOTHING`, [orderId, paymentId, amountCents, currency, correlationId]); return this.getTransaction(orderId); }
  async recordAttempt(orderId: string, operation: string, attempt: number, result: string, reason: string | undefined, durationMs: number) { await this.pool.query('INSERT INTO payment_attempts(order_id,operation,attempt_number,result,reason,duration_ms) VALUES($1,$2,$3,$4,$5,$6)', [orderId, operation, attempt, result, reason ?? null, durationMs]); }
  async finish(orderId: string, status: string, reason: string | undefined, event: PaymentEvent) { await this.pool.query('UPDATE payment_transactions SET status=$2, reason=$3, result_event=$4, updated_at=now() WHERE order_id=$1', [orderId, status, reason ?? null, event]); }
  async finishWithOutbox(orderId: string, status: string, reason: string | undefined, event: PaymentEvent) {
    await this.tx(async (client) => {
      await client.query('UPDATE payment_transactions SET status=$2, reason=$3, result_event=$4, payment_id=$5, updated_at=now() WHERE order_id=$1', [orderId, status, reason ?? null, event, String(event.payload.paymentId)]);
      await client.query('INSERT INTO outbox(id,topic,event_key,event_type,aggregate_id,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [event.eventId, process.env.KAFKA_RESULT_TOPIC ?? 'payments.results.v1', event.orderId, event.eventType, event.orderId, event]);
    });
  }
  async markReversalPending(orderId: string, event: PaymentEvent) { await this.pool.query('UPDATE payment_transactions SET status=\'reversion_pendiente\', reason=$3, result_event=$2, updated_at=now() WHERE order_id=$1', [orderId, event, String(event.payload.reason ?? 'Reversión pendiente')]); }
  async addOutbox(event: PaymentEvent) { await this.pool.query('INSERT INTO outbox(id,topic,event_key,event_type,aggregate_id,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [event.eventId, process.env.KAFKA_RESULT_TOPIC ?? 'payments.results.v1', event.orderId, event.eventType, event.orderId, event]); }
  async pendingOutbox(limit = 50) { await this.waitReady(); const result = await this.pool.query('SELECT id,topic,event_key,payload FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT $1', [limit]); return result.rows; }
  async markOutbox(id: string) { await this.pool.query('UPDATE outbox SET published_at=now(), attempts=attempts+1 WHERE id=$1', [id]); }
  async failOutbox(id: string) { await this.pool.query('UPDATE outbox SET attempts=attempts+1 WHERE id=$1', [id]); }
  async wasProcessed(eventId: string) { const result = await this.pool.query('SELECT event_id FROM inbox WHERE event_id=$1', [eventId]); return Boolean(result.rows[0]); }
  async markProcessed(event: PaymentEvent) { await this.pool.query('INSERT INTO inbox(event_id,event_type) VALUES($1,$2) ON CONFLICT DO NOTHING', [event.eventId, event.eventType]); }
}
