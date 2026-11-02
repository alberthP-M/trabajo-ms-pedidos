import { PasarelaService } from '../src/pasarela.service';

describe('PasarelaService', () => {
  beforeEach(() => { process.env.STUB_MODE = 'deterministic'; process.env.STUB_ERROR_RATE = '0'; process.env.STUB_REJECT_RATE = '0'; process.env.STUB_MAX_LATENCY_MS = '0'; process.env.STUB_EXECUTE_THEN_TIMEOUT_RATE = '0'; });

  it('mantiene el mismo resultado para una clave de idempotencia', async () => {
    const service = new PasarelaService();
    const input = { paymentToken: 'tok_demo', amountCents: 3500, currency: 'BOB', idempotencyKey: '33333333-3333-4333-8333-333333333333' };
    const first = await service.authorize(input);
    const second = await service.authorize(input);
    expect(first).toEqual(second);
  });

  it('comparte el resultado de dos autorizaciones concurrentes con la misma clave', async () => {
    const service = new PasarelaService();
    const input = { paymentToken: 'tok_demo', amountCents: 3500, currency: 'BOB', idempotencyKey: 'pedido-concurrente' };
    const [first, second] = await Promise.all([service.authorize(input), service.authorize(input)]);
    expect(first.operationId).toBe(second.operationId);
  });

  it('puede rechazar de forma determinista', async () => {
    const service = new PasarelaService();
    const result = await service.authorize({ paymentToken: 'tok_reject', amountCents: 1000, currency: 'BOB', idempotencyKey: '44444444-4444-4444-8444-444444444444' });
    expect(result.approved).toBe(false);
  });

  it('revierte la operación aprobada usando su identificador real sin duplicarla', async () => {
    const service = new PasarelaService();
    const authorization = await service.authorize({ paymentToken: 'tok_demo', amountCents: 3500, currency: 'BOB', idempotencyKey: 'pedido-para-revertir' });
    expect(authorization.approved).toBe(true);
    const input = { paymentId: authorization.operationId!, amountCents: 3500, currency: 'BOB', idempotencyKey: 'reverse-pedido-para-revertir' };
    const first = await service.reverse(input);
    const second = await service.reverse(input);
    expect(first.reversed).toBe(true);
    expect(second).toEqual(first);
  });
});
