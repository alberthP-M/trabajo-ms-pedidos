import { PagosService } from '../src/pagos.service';

describe('PagosService', () => {
  it('usa el identificador de operación de la pasarela para poder revertir', async () => {
    const command: any = { eventId: crypto.randomUUID(), eventType: 'CobroSolicitado', orderId: crypto.randomUUID(), correlationId: crypto.randomUUID(), payload: { paymentToken: 'tok_aprobado', amountCents: 3500, currency: 'BOB' } };
    const db: any = { wasProcessed: jest.fn().mockResolvedValue(false), getTransaction: jest.fn().mockResolvedValue(undefined), startTransaction: jest.fn(), recordAttempt: jest.fn(), finishWithOutbox: jest.fn(), markProcessed: jest.fn() };
    const stub: any = { authorize: jest.fn().mockResolvedValue({ approved: true, operationId: 'id-real-de-pasarela' }) };
    const service = new PagosService(db, {} as any, stub);
    await service.handleCommand(command);
    expect(db.finishWithOutbox).toHaveBeenCalledWith(command.orderId, 'aprobado', undefined, expect.objectContaining({ payload: { paymentId: 'id-real-de-pasarela', amountCents: 3500, currency: 'BOB' } }));
    expect(db.markProcessed).toHaveBeenCalledWith(command);
  });

  it('registra la reversión pendiente y la reintenta sin duplicar resultados fallidos', async () => {
    const orderId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const command: any = { eventId: crypto.randomUUID(), eventType: 'ReversionSolicitada', orderId, correlationId, payload: { paymentId: 'id-real-de-pasarela', amountCents: 3500, currency: 'BOB' } };
    const transaction = { status: 'aprobado', paymentId: 'id-real-de-pasarela', amountCents: 3500, currency: 'BOB' };
    const db: any = { wasProcessed: jest.fn().mockResolvedValue(false), getTransaction: jest.fn().mockImplementation(async () => transaction), recordAttempt: jest.fn(), finishWithOutbox: jest.fn(), markReversalPending: jest.fn(), markProcessed: jest.fn(), pendingReversals: jest.fn().mockResolvedValue([{ orderId, correlationId, paymentId: transaction.paymentId, amountCents: 3500, currency: 'BOB' }]) };
    const stub: any = { reverse: jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ approved: true, operationId: 'reversa-1' }) };
    const service = new PagosService(db, {} as any, stub);
    await service.handleCommand(command);
    expect(db.finishWithOutbox).toHaveBeenCalledWith(orderId, 'reversion_pendiente', expect.stringContaining('timeout'), expect.objectContaining({ eventType: 'ReversionResultado', payload: expect.objectContaining({ reversed: false }) }));
    expect(db.markProcessed).toHaveBeenCalledWith(command);
    transaction.status = 'reversion_pendiente';
    await (service as any).reconcileReversals();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(db.finishWithOutbox).toHaveBeenLastCalledWith(orderId, 'revertido', undefined, expect.objectContaining({ eventType: 'ReversionResultado', payload: expect.objectContaining({ reversed: true }) }));
    expect(db.markReversalPending).not.toHaveBeenCalled();
  });
});
