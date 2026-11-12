import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type ReservationItem = { productId: string; quantity: number };

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://catalogo:catalogo@localhost:5432/catalogo_db' });

  async onModuleInit() {
    const candidates = [resolve(process.cwd(), 'migrations'), resolve(process.cwd(), 'services/ms-catalogo/migrations'), join(__dirname, '../migrations')];
    const dir = candidates.find((candidate) => existsSync(candidate));
    if (!dir) throw new Error('No se encontró la carpeta de migraciones de Catálogo');
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
      await this.pool.query(readFileSync(join(dir, file), 'utf8'));
    }
  }

  async onModuleDestroy() { await this.pool.end(); }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async listBranches() {
    const { rows } = await this.pool.query('SELECT id, name, address FROM branches ORDER BY name');
    return rows;
  }

  async listMenu(branchId: string) {
    const { rows } = await this.pool.query(`
      SELECT p.id, p.name, p.description, bp.price_cents AS "priceCents", bp.currency,
             bp.stock_total AS "stockTotal",
             (bp.stock_total - bp.stock_reserved) AS "availableStock"
      FROM branch_products bp JOIN products p ON p.id = bp.product_id
      WHERE bp.branch_id = $1 ORDER BY p.name`, [branchId]);
    return rows;
  }

  async upsertProduct(branchId: string, input: { productId?: string; name: string; description?: string; priceCents: number; stockTotal: number }) {
    return this.withTransaction(async (client) => {
      const productId = input.productId ?? `producto-${crypto.randomUUID()}`;
      await client.query(`INSERT INTO products(id, name, description) VALUES($1,$2,$3)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description`, [productId, input.name, input.description ?? '']);
      const result = await client.query(`INSERT INTO branch_products(branch_id, product_id, price_cents, stock_total)
        VALUES($1,$2,$3,$4) ON CONFLICT(branch_id, product_id) DO UPDATE SET price_cents=EXCLUDED.price_cents,
        stock_total=EXCLUDED.stock_total, updated_at=now()
        WHERE EXCLUDED.stock_total >= branch_products.stock_reserved
        RETURNING branch_id AS "branchId", product_id AS "productId", price_cents AS "priceCents", stock_total AS "stockTotal", stock_reserved AS "stockReserved"`,
      [branchId, productId, input.priceCents, input.stockTotal]);
      if (!result.rows[0]) throw new ConflictException('El stock total no puede ser menor al reservado');
      return result.rows[0];
    });
  }

  async updateStock(branchId: string, productId: string, stockTotal: number) {
    const { rows } = await this.pool.query(`UPDATE branch_products SET stock_total=$3, version=version+1, updated_at=now()
      WHERE branch_id=$1 AND product_id=$2 AND $3 >= stock_reserved
      RETURNING branch_id AS "branchId", product_id AS "productId", stock_total AS "stockTotal", stock_reserved AS "stockReserved"`, [branchId, productId, stockTotal]);
    if (!rows[0]) throw new ConflictException('Producto inexistente o stock menor al reservado');
    return rows[0];
  }

  async reserve(id: string, branchId: string, items: ReservationItem) { return this.reserveMany(id, branchId, [items]); }

  async reserveMany(id: string, branchId: string, items: ReservationItem[]) {
    if (!id) throw new BadRequestException('x-reservation-id es obligatorio');
    if (!items.length || new Set(items.map((item) => item.productId)).size !== items.length) throw new BadRequestException('Ítems vacíos o repetidos');
    return this.withTransaction(async (client) => {
      const existing = await client.query('SELECT id, branch_id AS "branchId", status FROM reservations WHERE id=$1 FOR UPDATE', [id]);
      if (existing.rows[0]) {
        if (existing.rows[0].branchId !== branchId) throw new ConflictException('Reserva pertenece a otra sucursal');
        return this.reservationSummary(client, id);
      }
      const ids = items.map((item) => item.productId);
      const products = await client.query(`SELECT bp.product_id AS "productId", bp.price_cents AS "priceCents", (bp.stock_total-bp.stock_reserved) AS available
        FROM branch_products bp WHERE bp.branch_id=$1 AND bp.product_id = ANY($2::text[]) FOR UPDATE`, [branchId, ids]);
      if (products.rows.length !== items.length) throw new BadRequestException('Uno o más productos no existen en la sucursal');
      const byId = new Map(products.rows.map((row) => [row.productId, row]));
      for (const item of items) {
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new BadRequestException('Cantidad inválida');
        const product = byId.get(item.productId);
        if (!product || product.available < item.quantity) throw new ConflictException(`Stock insuficiente para ${item.productId}`);
      }
      await client.query('INSERT INTO reservations(id, branch_id, status) VALUES($1,$2,\'activa\')', [id, branchId]);
      for (const item of items) {
        const product = byId.get(item.productId)!;
        await client.query('INSERT INTO reservation_items(reservation_id, product_id, quantity, price_cents) VALUES($1,$2,$3,$4)', [id, item.productId, item.quantity, product.priceCents]);
        await client.query('UPDATE branch_products SET stock_reserved=stock_reserved+$3, version=version+1, updated_at=now() WHERE branch_id=$1 AND product_id=$2', [branchId, item.productId, item.quantity]);
      }
      return this.reservationSummary(client, id);
    });
  }

  private async reservationSummary(client: PoolClient, id: string) {
    const reservation = await client.query('SELECT id, branch_id AS "branchId", status FROM reservations WHERE id=$1', [id]);
    const items = await client.query('SELECT product_id AS "productId", quantity, price_cents AS "priceCents" FROM reservation_items WHERE reservation_id=$1 ORDER BY product_id', [id]);
    return { ...reservation.rows[0], items: items.rows, totalCents: items.rows.reduce((sum, item) => sum + item.quantity * item.priceCents, 0) };
  }

  async transitionReservation(id: string, target: 'consolidada' | 'liberada') {
    return this.withTransaction(async (client) => {
      const reservation = await client.query('SELECT id, branch_id AS "branchId", status FROM reservations WHERE id=$1 FOR UPDATE', [id]);
      if (!reservation.rows[0]) throw new NotFoundException('Reserva inexistente');
      const current = reservation.rows[0].status;
      if (current === target) return { ...reservation.rows[0], idempotent: true };
      if (current !== 'activa') throw new ConflictException(`Reserva ya está ${current}`);
      const items = await client.query('SELECT product_id AS "productId", quantity FROM reservation_items WHERE reservation_id=$1', [id]);
      for (const item of items.rows) {
        const delta = target === 'consolidada' ? `stock_total=stock_total-$3, stock_reserved=stock_reserved-$3` : 'stock_reserved=stock_reserved-$3';
        await client.query(`UPDATE branch_products SET ${delta}, version=version+1, updated_at=now() WHERE branch_id=$1 AND product_id=$2`, [reservation.rows[0].branchId, item.productId, item.quantity]);
      }
      const { rows } = await client.query('UPDATE reservations SET status=$2, updated_at=now() WHERE id=$1 RETURNING id, branch_id AS "branchId", status', [id, target]);
      return { ...rows[0], idempotent: false };
    });
  }
}
