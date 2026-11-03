import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CircuitOpenError } from './circuit-breaker';
import { DatabaseService, PaymentEvent } from './database';
import { KafkaService } from './kafka.service';
import { GatewayResult, StubClient } from './stub.client';

@Injectable()
export class PagosService {
  private readonly logger = new Logger(PagosService.name);
  private publisher?: NodeJS.Timeout;
  private reversalReconciler?: NodeJS.Timeout;
  private readonly runningReversals = new Set<string>();
  constructor(private readonly db: DatabaseService, private readonly kafka: KafkaService, private readonly stub: StubClient) {}

  async onModuleInit() { setTimeout(() => void this.kafka.startCommandConsumer((event) => this.handleCommand(event)), 1000); this.publisher = setInterval(() => void this.publishOutbox(), 1000); void this.publishOutbox(); this.reversalReconciler = setInterval(() => void this.reconcileReversals(), 5000); void this.reconcileReversals(); }
  async onModuleDestroy() { if (this.publisher) clearInterval(this.publisher); if (this.reversalReconciler) clearInterval(this.reversalReconciler); }

  async handleCommand(event: PaymentEvent) {
    if (!['CobroSolicitado', 'ReversionSolicitada'].includes(event.eventType)) return;
    if (await this.db.wasProcessed(event.eventId)) return;
    if (event.eventType === 'CobroSolicitado') await this.authorize(event); else await this.reverse(event);
    await this.db.markProcessed(event);
  }

  private async authorize(command: PaymentEvent) {
    const amountCents = Number(command.payload.amountCents); const currency = String(command.payload.currency ?? 'BOB');
    const existing = await this.db.getTransaction(command.orderId);
    if (existing?.resultEvent && ['PagoAprobado', 'PagoRechazado'].includes((existing.resultEvent as PaymentEvent).eventType)) { await this.db.addOutbox(existing.resultEvent as PaymentEvent); return; }
    const provisionalId = existing?.paymentId ?? randomUUID();
    await this.db.startTransaction(command.orderId, provisionalId, amountCents, currency, command.correlationId);
    let result: GatewayResult;
    try {
      result = await this.stub.authorize(command.orderId, String(command.payload.paymentToken), amountCents, currency, (attempt, status, reason, duration) => this.db.recordAttempt(command.orderId, 'authorize', attempt, status, reason, duration));
    } catch (error) {
      const reason = error instanceof CircuitOpenError ? error.message : `Pasarela no disponible tras reintentos: ${String(error instanceof Error ? error.message : error)}`;
      result = { approved: false, reason };
    }
    const paymentId = result.operationId ?? provisionalId;
    const output: PaymentEvent = { eventId: randomUUID(), eventType: result.approved ? 'PagoAprobado' : 'PagoRechazado', schemaVersion: '1', orderId: command.orderId, correlationId: command.correlationId, occurredAt: new Date().toISOString(), payload: result.approved ? { paymentId, amountCents, currency } : { paymentId, amountCents, currency, reason: result.reason ?? 'Cobro rechazado' } };
    await this.db.finishWithOutbox(command.orderId, result.approved ? 'aprobado' : 'rechazado', result.reason, output);
    this.logger.log({ event: output.eventType, orderId: command.orderId, correlationId: command.correlationId, paymentId });
  }

  private async reverse(command: PaymentEvent) {
    const existing = await this.db.getTransaction(command.orderId);
    if (!existing) { const output = this.reversalEvent(command, false, 'Transacción inexistente'); await this.db.addOutbox(output); return; }
    if (existing.status === 'revertido' && existing.resultEvent) { await this.db.addOutbox(existing.resultEvent as PaymentEvent); return; }
    let result: GatewayResult;
    try { result = await this.stub.reverse(command.orderId, String(command.payload.paymentId ?? existing.paymentId), Number(command.payload.amountCents ?? existing.amountCents), String(command.payload.currency ?? existing.currency), (attempt, status, reason, duration) => this.db.recordAttempt(command.orderId, 'reverse', attempt, status, reason, duration)); }
    catch (error) { result = { approved: false, reason: `Pasarela no disponible para reversión: ${String(error)}` }; }
    const output = this.reversalEvent(command, result.approved, result.reason);
    if (!result.approved && existing.status === 'reversion_pendiente') await this.db.markReversalPending(command.orderId, output);
    else await this.db.finishWithOutbox(command.orderId, result.approved ? 'revertido' : 'reversion_pendiente', result.reason, output);
    if (!result.approved) this.logger.warn({ event: 'ReversionPendiente', orderId: command.orderId, correlationId: command.correlationId, reason: result.reason });
  }

  private async reconcileReversals() {
    try {
      for (const row of await this.db.pendingReversals()) {
        if (this.runningReversals.has(row.orderId)) continue;
        this.runningReversals.add(row.orderId);
        const command: PaymentEvent = { eventId: randomUUID(), eventType: 'ReversionSolicitada', schemaVersion: '1', orderId: row.orderId, correlationId: row.correlationId, occurredAt: new Date().toISOString(), payload: { paymentId: row.paymentId, amountCents: row.amountCents, currency: row.currency } };
        void this.reverse(command).catch((error) => this.logger.error({ event: 'ReintentoReversionFallido', orderId: row.orderId, error: String(error) })).finally(() => this.runningReversals.delete(row.orderId));
      }
    } catch (error) { this.logger.warn({ event: 'ReconciliacionReversionFallida', error: String(error) }); }
  }

  private reversalEvent(command: PaymentEvent, reversed: boolean, reason?: string): PaymentEvent { return { eventId: randomUUID(), eventType: 'ReversionResultado', schemaVersion: '1', orderId: command.orderId, correlationId: command.correlationId, occurredAt: new Date().toISOString(), payload: { paymentId: String(command.payload.paymentId ?? ''), reversed, reason } }; }

  private async publishOutbox() { try { for (const record of await this.db.pendingOutbox()) { try { await this.kafka.send(record.topic, record.event_key, record.payload as PaymentEvent); await this.db.markOutbox(record.id); } catch (error) { await this.db.failOutbox(record.id); this.logger.warn({ outboxId: record.id, error: String(error) }); } } } catch (error) { this.logger.warn(`Outbox de Pagos no disponible: ${String(error)}`); } }
}
