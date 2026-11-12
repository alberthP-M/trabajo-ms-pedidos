import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { CatalogoClient } from './catalogo.client';
import { AuthUser } from './common/auth';
import { DatabaseService, EventRecord, OrderScope } from './database';
import { KafkaService } from './kafka.service';

export type CreateOrderInput = { branchId: string; items: Array<{ productId: string; quantity: number }>; paymentToken: string; currency?: string };

@Injectable()
export class PedidosService {
  private readonly logger = new Logger(PedidosService.name);
  private publisher?: NodeJS.Timeout;
  private reconciler?: NodeJS.Timeout;
  private readonly runningReservations = new Set<string>();

  constructor(private readonly db: DatabaseService, private readonly catalogo: CatalogoClient, private readonly kafka: KafkaService) {}

  async onModuleInit() {
    setTimeout(() => void this.kafka.startResultsConsumer((event) => this.handlePaymentResult(event)), 1000);
    this.publisher = setInterval(() => void this.publishOutbox(), 1000);
    void this.publishOutbox();
    this.reconciler = setInterval(() => void this.reconcileReservations(), 3000);
    void this.reconcileReservations();
  }

  async onModuleDestroy() { if (this.publisher) clearInterval(this.publisher); if (this.reconciler) clearInterval(this.reconciler); }

  async create(clientId: string, input: CreateOrderInput, idempotencyKey: string) {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key es obligatorio');
    if (!input.items?.length || input.items.some((item) => !Number.isInteger(item.quantity) || item.quantity <= 0)) throw new BadRequestException('Ítems inválidos');
    if (!input.paymentToken?.trim()) throw new BadRequestException('paymentToken es obligatorio');
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const orderId = randomUUID();
    const created = await this.db.createOrder({ id: orderId, clientId, branchId: input.branchId, items: input.items, paymentToken: input.paymentToken, currency: input.currency ?? 'BOB', totalCents: 1, correlationId: randomUUID(), requestHash, idempotencyKey });
    if (created.existing) {
      if (created.requestHash !== requestHash) throw new BadRequestException('La clave de idempotencia se reutilizó con otro pedido');
      return this.db.getOrder(created.orderId, { clientId });
    }
    void this.startSaga(orderId).catch((error) => this.logger.error({ orderId, event: 'InicioSagaFallido', error: String(error) }));
    return this.db.getOrder(orderId, { clientId });
  }

  async list(user: AuthUser) { return this.db.listOrders(this.scopeFor(user)); }

  async get(orderId: string, user: AuthUser) {
    const order = await this.db.getOrder(orderId, this.scopeFor(user));
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return order;
  }

  private scopeFor(user: AuthUser): OrderScope {
    if (user.role === 'cliente') return { clientId: user.sub };
    if (user.role === 'sucursal' && user.branchId) return { branchId: user.branchId };
    throw new ForbiddenException('El rol no puede consultar pedidos');
  }

  private async startSaga(orderId: string) {
    if (this.runningReservations.has(orderId)) return;
    this.runningReservations.add(orderId);
    try { await this.reserveAndRequestPayment(orderId); }
    finally { this.runningReservations.delete(orderId); }
  }

  private async reconcileReservations() {
    try {
      for (const orderId of await this.db.pendingReservations()) void this.startSaga(orderId).catch((error) => this.logger.error({ orderId, event: 'ReintentoSagaFallido', error: String(error) }));
    } catch (error) { this.logger.warn({ event: 'ReconciliacionFallida', error: String(error) }); }
  }

  private async reserveAndRequestPayment(orderId: string) {
    const order = await this.db.getOrderForSaga(orderId);
    if (!order || order.status !== 'pendiente' || order.internal_status !== 'reservando') return;
    try {
      const items = await this.db.getOrderItems(orderId);
      const reservation = await this.withRetries(() => this.catalogo.reserve(orderId, order.branch_id, items, order.correlation_id));
      await this.db.saveReservation(orderId, orderId, Number(reservation.totalCents), reservation.items);
      this.logger.log({ orderId, correlationId: order.correlation_id, event: 'CobroSolicitado' });
    } catch (error) {
      const reason = String(error instanceof Error ? error.message : error);
      if (/stock insuficiente|productos no existen|ítems inválidos/i.test(reason)) {
        await this.db.transition(orderId, 'rechazado', 'finalizado', reason, order.correlation_id);
        this.logger.warn({ orderId, correlationId: order.correlation_id, event: 'ReservaRechazada', reason });
      } else {
        await this.db.markSaga(orderId, 'reservando', reason);
        this.logger.warn({ orderId, correlationId: order.correlation_id, event: 'ReservaPendienteDeReintento', reason });
      }
    }
  }

  private async withRetries<T>(operation: () => Promise<T>) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) { try { return await operation(); } catch (error) { lastError = error; if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 100 * attempt)); } }
    throw lastError;
  }

  async handlePaymentResult(event: EventRecord) {
    if (!['PagoAprobado', 'PagoRechazado', 'ReversionResultado'].includes(event.eventType)) return;
    const order = await this.db.getOrderForSaga(event.orderId);
    if (!order) return;
    await this.db.processPaymentResult(event, async () => {
      if (event.eventType === 'PagoRechazado') {
        await this.db.markSaga(event.orderId, 'liberando');
        await this.withRetries(() => this.catalogo.release(event.orderId, event.correlationId));
        await this.db.transition(event.orderId, 'rechazado', 'finalizado', String(event.payload.reason ?? 'Cobro rechazado'), event.correlationId);
        return;
      }
      if (event.eventType === 'PagoAprobado') {
        if (order.status === 'confirmado') return;
        try {
          await this.db.markSaga(event.orderId, 'consolidando');
          await this.withRetries(() => this.catalogo.consolidate(event.orderId, event.correlationId));
        } catch (error) {
          const paymentId = String(event.payload.paymentId ?? '');
          await this.db.createReversalEvent(event.orderId, paymentId, Number(event.payload.amountCents), String(event.payload.currency ?? 'BOB'), event.correlationId);
          this.logger.warn({ orderId: event.orderId, correlationId: event.correlationId, event: 'ReversionSolicitada', reason: String(error) });
          return;
        }
        await this.db.transition(event.orderId, 'confirmado', 'finalizado', 'Pago aprobado y stock consolidado', event.correlationId);
        return;
      }
      const reversed = Boolean(event.payload.reversed);
      if (reversed) {
        await this.withRetries(() => this.catalogo.release(event.orderId, event.correlationId));
        await this.db.transition(event.orderId, 'rechazado', 'finalizado', 'Cobro aprobado, revertido y reserva liberada', event.correlationId);
      } else {
        const reason = `No se pudo revertir el cobro: ${String(event.payload.reason ?? 'motivo desconocido')}`;
        await this.db.markSaga(event.orderId, 'reversion_pendiente', reason);
        this.logger.warn({ orderId: event.orderId, correlationId: event.correlationId, event: 'ReversionPendiente', reason });
      }
    });
  }

  private async publishOutbox() {
    try {
      for (const record of await this.db.pendingOutbox()) {
        try { await this.kafka.send(record.topic, record.event_key, record.payload as EventRecord); await this.db.markOutbox(record.id); }
        catch (error) { await this.db.failOutbox(record.id); this.logger.warn({ outboxId: record.id, error: String(error) }); }
      }
    } catch (error) { this.logger.warn(`Outbox de Pedidos no disponible: ${String(error)}`); }
  }
}
