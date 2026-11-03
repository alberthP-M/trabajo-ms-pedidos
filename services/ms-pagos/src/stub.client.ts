import { Injectable } from '@nestjs/common';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

export type GatewayResult = { approved: boolean; operationId?: string; reason?: string };

@Injectable()
export class StubClient {
  private readonly baseUrl = process.env.PAYMENT_STUB_URL ?? 'http://localhost:3004';
  private readonly breaker = new CircuitBreaker();
  private readonly timeout = Number(process.env.PAYMENT_TIMEOUT_MS ?? 1200);
  private readonly maxRetries = Number(process.env.PAYMENT_MAX_RETRIES ?? 3);

  private async request(path: string, init: RequestInit = {}, timeoutMs = this.timeout) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }, signal: controller.signal }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(`${response.status}: ${body.reason ?? body.message ?? 'Error de pasarela'}`); return body; }
    finally { clearTimeout(timer); }
  }

  async authorize(orderId: string, paymentToken: string, amountCents: number, currency: string, attempt: (number: number, result: string, reason: string | undefined, durationMs: number) => Promise<void>): Promise<GatewayResult> {
    let lastError: unknown;
    for (let number = 1; number <= this.maxRetries; number++) {
      const started = Date.now();
      try {
        const result = await this.breaker.execute(() => this.request('/authorize', { method: 'POST', headers: { 'x-idempotency-key': orderId }, body: JSON.stringify({ paymentToken, amountCents, currency, idempotencyKey: orderId }) }));
        await attempt(number, result.approved ? 'aprobado' : 'rechazado', result.reason, Date.now() - started);
        return result;
      } catch (error) {
        lastError = error;
        try {
          const known = await this.request(`/operations/${encodeURIComponent(orderId)}`, {}, Math.min(this.timeout, 500));
          if (known?.status === 'approved') { await attempt(number, 'aprobado-reconciliado', undefined, Date.now() - started); return { approved: true, operationId: known.operationId }; }
          if (known?.status === 'rejected') { await attempt(number, 'rechazado-reconciliado', known.reason, Date.now() - started); return { approved: false, reason: known.reason }; }
        } catch { /* operación aún incierta; se reintenta con la misma clave */ }
        await attempt(number, 'error', String(error instanceof Error ? error.message : error), Date.now() - started);
        if (this.breaker.state === 'open') throw new CircuitOpenError();
        if (number < this.maxRetries) await new Promise((resolve) => setTimeout(resolve, Number(process.env.PAYMENT_BACKOFF_MS ?? 150) * 2 ** (number - 1) + Math.floor(Math.random() * 50)));
      }
    }
    throw lastError;
  }

  async reverse(orderId: string, paymentId: string, amountCents: number, currency: string, attempt: (number: number, result: string, reason: string | undefined, durationMs: number) => Promise<void>): Promise<GatewayResult> {
    let lastError: unknown;
    for (let number = 1; number <= this.maxRetries; number++) {
      const started = Date.now();
      try { const result = await this.breaker.execute(() => this.request('/reverse', { method: 'POST', headers: { 'x-idempotency-key': `reverse-${orderId}` }, body: JSON.stringify({ paymentId, amountCents, currency, idempotencyKey: `reverse-${orderId}` }) })); await attempt(number, result.reversed ? 'revertido' : 'rechazado', result.reason, Date.now() - started); return { approved: Boolean(result.reversed), operationId: result.operationId, reason: result.reason }; }
      catch (error) { lastError = error; await attempt(number, 'error', String(error instanceof Error ? error.message : error), Date.now() - started); if (number < this.maxRetries) await new Promise((resolve) => setTimeout(resolve, Number(process.env.PAYMENT_BACKOFF_MS ?? 150) * 2 ** (number - 1))); }
    }
    throw lastError;
  }
}
