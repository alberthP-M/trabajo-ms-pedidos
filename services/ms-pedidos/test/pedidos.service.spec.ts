import { PedidosService } from '../src/pedidos.service';

function event(eventType: string, payload: Record<string, unknown>) {
  return { eventId: crypto.randomUUID(), eventType, schemaVersion: '1', orderId: '11111111-1111-4111-8111-111111111111', correlationId: '22222222-2222-4222-8222-222222222222', occurredAt: new Date().toISOString(), payload } as any;
}

describe('PedidosService saga', () => {
  const baseOrder = { id: '11111111-1111-4111-8111-111111111111', branch_id: 'sucursal-centro', correlation_id: '22222222-2222-4222-8222-222222222222', status: 'pendiente', internal_status: 'reservando' };

  it('reserva y publica el cobro cuando hay stock', async () => {
    const db: any = {
      getOrderForSaga: jest.fn().mockResolvedValue(baseOrder),
      getOrderItems: jest.fn().mockResolvedValue([{ productId: 'producto-hamburguesa', quantity: 1 }]),
      saveReservation: jest.fn().mockResolvedValue({}),
      markSaga: jest.fn(),
      transition: jest.fn(),
    };
    const catalogo: any = { reserve: jest.fn().mockResolvedValue({ totalCents: 3500, items: [{ productId: 'producto-hamburguesa', quantity: 1, priceCents: 3500 }] }) };
    const service = new PedidosService(db, catalogo, {} as any);
    await (service as any).startSaga(baseOrder.id);
    expect(catalogo.reserve).toHaveBeenCalledWith(baseOrder.id, baseOrder.branch_id, expect.any(Array), baseOrder.correlation_id);
    expect(db.saveReservation).toHaveBeenCalledWith(baseOrder.id, baseOrder.id, 3500, expect.any(Array));
    expect(db.transition).not.toHaveBeenCalled();
  });

  it('rechaza el pedido cuando Catálogo informa stock insuficiente', async () => {
    const db: any = {
      getOrderForSaga: jest.fn().mockResolvedValue(baseOrder),
      getOrderItems: jest.fn().mockResolvedValue([{ productId: 'producto-hamburguesa', quantity: 99 }]),
      updateTotal: jest.fn(),
      saveReservation: jest.fn(),
      markSaga: jest.fn(),
      transition: jest.fn().mockResolvedValue(undefined),
    };
    const catalogoError = Object.assign(new Error('Stock insuficiente'), { totalCents: 3500 });
    const catalogo: any = { reserve: jest.fn().mockRejectedValue(catalogoError) };
    const service = new PedidosService(db, catalogo, {} as any);
    await (service as any).startSaga(baseOrder.id);
    expect(db.updateTotal).toHaveBeenCalledWith(baseOrder.id, 3500);
    expect(db.transition).toHaveBeenCalledWith(baseOrder.id, 'rechazado', 'finalizado', expect.stringContaining('Stock insuficiente'), baseOrder.correlation_id);
    expect(db.saveReservation).not.toHaveBeenCalled();
  });

  it('libera la reserva cuando el cobro es rechazado', async () => {
    const db: any = {
      getOrderForSaga: jest.fn().mockResolvedValue(baseOrder),
      processPaymentResult: jest.fn(async (_event: any, apply: () => Promise<void>) => apply()),
      markSaga: jest.fn(),
      transition: jest.fn().mockResolvedValue(undefined),
    };
    const catalogo: any = { release: jest.fn().mockResolvedValue({}) };
    const service = new PedidosService(db, catalogo, {} as any);
    await service.handlePaymentResult(event('PagoRechazado', { reason: 'Emisor rechazó el token', amountCents: 3500, currency: 'BOB' }));
    expect(catalogo.release).toHaveBeenCalledWith(baseOrder.id, baseOrder.correlation_id);
    expect(db.transition).toHaveBeenCalledWith(baseOrder.id, 'rechazado', 'finalizado', 'Emisor rechazó el token', baseOrder.correlation_id);
  });

  it('reintenta una reserva si falla la persistencia local después de reservar', async () => {
    const db: any = { getOrderForSaga: jest.fn().mockResolvedValue(baseOrder), getOrderItems: jest.fn().mockResolvedValue([{ productId: 'producto-hamburguesa', quantity: 1 }]), saveReservation: jest.fn().mockRejectedValueOnce(new Error('DB temporal')).mockResolvedValueOnce({}), markSaga: jest.fn() };
    const catalogo: any = { reserve: jest.fn().mockResolvedValue({ totalCents: 3500, items: [{ productId: 'producto-hamburguesa', quantity: 1, priceCents: 3500 }] }) };
    const service = new PedidosService(db, catalogo, {} as any);
    await (service as any).startSaga(baseOrder.id);
    expect(db.transition).toBeUndefined();
    expect(db.markSaga).toHaveBeenCalledWith(baseOrder.id, 'reservando', expect.stringContaining('DB temporal'));
    await (service as any).startSaga(baseOrder.id);
    expect(catalogo.reserve).toHaveBeenCalledTimes(2);
    expect(db.saveReservation).toHaveBeenCalledTimes(2);
  });

  it('reanuda las reservas pendientes que encuentra al reconciliar', async () => {
    const db: any = { pendingReservations: jest.fn().mockResolvedValue([baseOrder.id]), getOrderForSaga: jest.fn().mockResolvedValue(baseOrder), getOrderItems: jest.fn().mockResolvedValue([{ productId: 'producto-hamburguesa', quantity: 1 }]), saveReservation: jest.fn() };
    const catalogo: any = { reserve: jest.fn().mockResolvedValue({ totalCents: 3500, items: [{ productId: 'producto-hamburguesa', quantity: 1, priceCents: 3500 }] }) };
    const service = new PedidosService(db, catalogo, {} as any);
    await (service as any).reconcileReservations();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(db.saveReservation).toHaveBeenCalledTimes(1);
  });

  it('solicita reversión una vez si no puede consolidar el stock', async () => {
    const db: any = { getOrderForSaga: jest.fn().mockResolvedValue({ ...baseOrder, internal_status: 'esperando_pago' }), processPaymentResult: jest.fn(async (_event: any, apply: () => Promise<void>) => apply()), markSaga: jest.fn(), createReversalEvent: jest.fn(), transition: jest.fn() };
    const catalogo: any = { consolidate: jest.fn().mockRejectedValue(new Error('Catálogo no disponible')) };
    const service = new PedidosService(db, catalogo, {} as any);
    await service.handlePaymentResult(event('PagoAprobado', { paymentId: 'operacion-pasarela', amountCents: 3500, currency: 'BOB' }));
    expect(db.createReversalEvent).toHaveBeenCalledTimes(1);
    expect(db.transition).not.toHaveBeenCalled();
  });

  it('registra la reversión pendiente y continúa al recibir luego un éxito', async () => {
    const db: any = { getOrderForSaga: jest.fn().mockResolvedValue(baseOrder), processPaymentResult: jest.fn(async (_event: any, apply: () => Promise<void>) => apply()), markSaga: jest.fn(), transition: jest.fn() };
    const catalogo: any = { release: jest.fn().mockResolvedValue({}) };
    const service = new PedidosService(db, catalogo, {} as any);
    await service.handlePaymentResult(event('ReversionResultado', { reversed: false, reason: 'timeout' }));
    expect(db.markSaga).toHaveBeenCalledWith(baseOrder.id, 'reversion_pendiente', expect.stringContaining('timeout'));
    expect(db.transition).not.toHaveBeenCalled();
    await service.handlePaymentResult(event('ReversionResultado', { reversed: true }));
    expect(catalogo.release).toHaveBeenCalledWith(baseOrder.id, baseOrder.correlation_id);
    expect(db.transition).toHaveBeenCalledWith(baseOrder.id, 'rechazado', 'finalizado', expect.stringContaining('revertido'), baseOrder.correlation_id);
  });
});
