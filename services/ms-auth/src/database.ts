import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { hashPassword } from './password';

export type UserRole = 'cliente' | 'sucursal';
export type UserRecord = { id: string; email: string; passwordHash: string; role: UserRole; branchId?: string; active: boolean };

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://auth:auth@localhost:5432/auth_db' });
  readonly ready = this.migrateAndSeed();

  private async migrateAndSeed() {
    const dirs = [resolve(process.cwd(), 'migrations'), resolve(process.cwd(), 'services/ms-auth/migrations'), join(__dirname, '../migrations')];
    const dir = dirs.find((candidate) => existsSync(candidate));
    if (!dir) throw new Error('No se encontró la carpeta de migraciones de ms-auth');
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
      await this.pool.query(readFileSync(join(dir, file), 'utf8'));
    }
    await this.seedUser({ id: 'cliente-demo', email: 'cliente@demo.local', password: process.env.SEED_CLIENT_PASSWORD ?? 'cliente123', role: 'cliente' });
    await this.seedUser({ id: 'sucursal-centro-demo', email: 'sucursal@demo.local', password: process.env.SEED_BRANCH_PASSWORD ?? 'sucursal123', role: 'sucursal', branchId: 'sucursal-centro' });
  }

  async waitReady() { await this.ready; }

  private async seedUser(input: { id: string; email: string; password: string; role: UserRole; branchId?: string }) {
    const existing = await this.pool.query('SELECT id FROM users WHERE email=$1', [input.email.toLowerCase()]);
    if (existing.rowCount) return;
    await this.pool.query('INSERT INTO users(id,email,password_hash,role,branch_id) VALUES($1,$2,$3,$4,$5)', [input.id, input.email.toLowerCase(), await hashPassword(input.password), input.role, input.branchId ?? null]);
  }

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    await this.waitReady();
    const result = await this.pool.query('SELECT id,email,password_hash AS "passwordHash",role,branch_id AS "branchId",active FROM users WHERE email=$1', [email.toLowerCase()]);
    return result.rows[0] as UserRecord | undefined;
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    await this.waitReady();
    const result = await this.pool.query('SELECT id,email,password_hash AS "passwordHash",role,branch_id AS "branchId",active FROM users WHERE id=$1', [id]);
    return result.rows[0] as UserRecord | undefined;
  }

  async createUser(input: { email: string; passwordHash: string; role: UserRole; branchId?: string }) {
    await this.waitReady();
    const id = randomUUID();
    await this.pool.query('INSERT INTO users(id,email,password_hash,role,branch_id) VALUES($1,$2,$3,$4,$5)', [id, input.email.toLowerCase(), input.passwordHash, input.role, input.branchId ?? null]);
    return this.findById(id);
  }

  async saveRefreshToken(userId: string, rawToken: string, expiresAt: Date) {
    await this.waitReady();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await this.pool.query('INSERT INTO refresh_tokens(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,$4)', [randomUUID(), userId, tokenHash, expiresAt]);
  }

  async consumeRefreshToken(rawToken: string) {
    await this.waitReady();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT rt.id, rt.user_id AS "userId", u.email, u.role, u.branch_id AS "branchId", u.active FROM refresh_tokens rt JOIN users u ON u.id=rt.user_id WHERE rt.token_hash=$1 AND rt.revoked_at IS NULL AND rt.expires_at > now() FOR UPDATE', [tokenHash]);
      const row = result.rows[0];
      if (!row) { await client.query('ROLLBACK'); return undefined; }
      await client.query('UPDATE refresh_tokens SET revoked_at=now() WHERE id=$1', [row.id]);
      await client.query('COMMIT');
      return row as { userId: string; email: string; role: UserRole; branchId?: string; active: boolean };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async revokeRefreshToken(rawToken: string) {
    await this.waitReady();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await this.pool.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at, now()) WHERE token_hash=$1', [tokenHash]);
  }

  async onModuleDestroy() { await this.pool.end(); }
}
