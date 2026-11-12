import { CatalogoService } from '../src/catalogo.service';

describe('CatalogoService', () => {
  it('delega una reserva completa al repositorio', async () => {
    const db: any = { reserveMany: jest.fn().mockResolvedValue({ id: 'order-1', status: 'activa' }) };
    const service = new CatalogoService(db);
    await expect(service.reserve('order-1', 'sucursal-centro', [{ productId: 'producto-hamburguesa', quantity: 2 }])).resolves.toEqual({ id: 'order-1', status: 'activa' });
    expect(db.reserveMany).toHaveBeenCalledWith('order-1', 'sucursal-centro', [{ productId: 'producto-hamburguesa', quantity: 2 }]);
  });

  it('expone la liberación como una operación separada de consolidación', async () => {
    const db: any = { transitionReservation: jest.fn().mockResolvedValue({ status: 'liberada' }) };
    const service = new CatalogoService(db);
    await service.release('order-1');
    await service.consolidate('order-2');
    expect(db.transitionReservation).toHaveBeenNthCalledWith(1, 'order-1', 'liberada');
    expect(db.transitionReservation).toHaveBeenNthCalledWith(2, 'order-2', 'consolidada');
  });
});
