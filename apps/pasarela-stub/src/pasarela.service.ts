import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

type Operation = { operationId: string; status: 'approved' | 'rejected' | 'reversed'; reason?: string; amountCents: number; currency: string; paymentId?: string };
type AuthorizeInput = { paymentToken: string; amountCents: number; currency: string; idempotencyKey: string };
type ReverseInput = { paymentId: string; amountCents: number; currency: string; idempotencyKey: string };

@Injectable()
export class PasarelaService {
  private readonly logger = new Logger(PasarelaService.name);
  private readonly operations = new Map<string, Operation>();
  private readonly reversals = new Map<string, Operation>();
  private readonly authorizing = new Map<string, Promise<{ approved: boolean; operationId: string; reason?: string }>>();
  private readonly reversing = new Map<string, Promise<{ reversed: boolean; operationId?: string; reason?: string }>>();
  private number(name: string) { const value = Number(process.env[name] ?? 0); return Number.isFinite(value) ? value : 0; }
  private async latency() { const max = this.number('STUB_MAX_LATENCY_MS'); if (max > 0) await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * max))); }
  private randomHit(name: string) { return Math.random() < Math.max(0, Math.min(1, this.number(name))); }

  async authorize(input: AuthorizeInput) {
    const existing = this.operations.get(input.idempotencyKey);
    if (existing) return { approved: existing.status === 'approved', operationId: existing.operationId, reason: existing.reason };
    const inFlight = this.authorizing.get(input.idempotencyKey);
    if (inFlight) return inFlight;
    const work = this.performAuthorization(input);
    this.authorizing.set(input.idempotencyKey, work);
    try { return await work; } finally { this.authorizing.delete(input.idempotencyKey); }
  }

  private async performAuthorization(input: AuthorizeInput) {
    await this.latency();
    if (this.randomHit('STUB_ERROR_RATE') || (process.env.STUB_MODE === 'deterministic' && input.paymentToken.toLowerCase().includes('error'))) throw new ServiceUnavailableException('Fallo simulado de pasarela');
    const reject = this.randomHit('STUB_REJECT_RATE') || (process.env.STUB_MODE === 'deterministic' && input.paymentToken.toLowerCase().includes('reject'));
    const operation: Operation = { operationId: randomUUID(), status: reject ? 'rejected' : 'approved', reason: reject ? 'Tarjeta/token rechazado por el emisor simulado' : undefined, amountCents: input.amountCents, currency: input.currency };
    this.operations.set(input.idempotencyKey, operation);
    if (this.randomHit('STUB_EXECUTE_THEN_TIMEOUT_RATE')) { this.logger.warn({ message: 'Respuesta perdida después de ejecutar autorización', idempotencyKey: input.idempotencyKey }); await new Promise((resolve) => setTimeout(resolve, Number(process.env.PAYMENT_TIMEOUT_MS ?? 1200) * 3)); }
    return { approved: operation.status === 'approved', operationId: operation.operationId, reason: operation.reason };
  }

  query(key: string) { const operation = this.operations.get(key); if (!operation) return { status: 'unknown' }; return { ...operation }; }

  async reverse(input: ReverseInput) {
    const existing = this.reversals.get(input.idempotencyKey);
    if (existing) return { reversed: existing.status === 'reversed', operationId: existing.operationId, reason: existing.reason };
    const inFlight = this.reversing.get(input.idempotencyKey);
    if (inFlight) return inFlight;
    const work = this.performReversal(input);
    this.reversing.set(input.idempotencyKey, work);
    try { return await work; } finally { this.reversing.delete(input.idempotencyKey); }
  }

  private async performReversal(input: ReverseInput) {
    await this.latency();
    if (this.randomHit('STUB_ERROR_RATE')) throw new ServiceUnavailableException('Fallo simulado al revertir');
    const source = [...this.operations.values()].find((op) => op.operationId === input.paymentId);
    if (!source || source.status !== 'approved') return { reversed: false, reason: 'Autorización no encontrada o no aprobada' };
    const operation: Operation = { operationId: randomUUID(), status: 'reversed', amountCents: input.amountCents, currency: input.currency, paymentId: input.paymentId };
    this.reversals.set(input.idempotencyKey, operation);
    return { reversed: true, operationId: operation.operationId };
  }
}
