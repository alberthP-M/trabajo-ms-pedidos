import { Injectable } from '@nestjs/common';
import { DatabaseService, ReservationItem } from './database';

@Injectable()
export class CatalogoService {
  constructor(private readonly db: DatabaseService) {}
  listBranches() { return this.db.listBranches(); }
  listMenu(branchId: string) { return this.db.listMenu(branchId); }
  saveProduct(branchId: string, input: { productId?: string; name: string; description?: string; priceCents: number; stockTotal: number }) { return this.db.upsertProduct(branchId, input); }
  updateStock(branchId: string, productId: string, stockTotal: number) { return this.db.updateStock(branchId, productId, stockTotal); }
  reserve(id: string, branchId: string, items: ReservationItem[]) { return this.db.reserveMany(id, branchId, items); }
  consolidate(id: string) { return this.db.transitionReservation(id, 'consolidada'); }
  release(id: string) { return this.db.transitionReservation(id, 'liberada'); }
}
