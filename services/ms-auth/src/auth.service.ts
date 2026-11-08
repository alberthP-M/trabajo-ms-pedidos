import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { DatabaseService, UserRecord, UserRole } from './database';
import { hashPassword, verifyPassword } from './password';

type PublicUser = { id: string; email: string; role: UserRole; branchId?: string };

@Injectable()
export class AuthService {
  constructor(private readonly db: DatabaseService) {}

  async register(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    if (await this.db.findByEmail(normalizedEmail)) throw new ConflictException('El correo ya está registrado');
    const user = await this.db.createUser({ email: normalizedEmail, passwordHash: await hashPassword(password), role: 'cliente' });
    if (!user) throw new Error('No se pudo crear el usuario');
    return this.issueSession(user);
  }

  async login(email: string, password: string) {
    const user = await this.db.findByEmail(email.trim().toLowerCase());
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedException('Credenciales inválidas');
    return this.issueSession(user);
  }

  async refresh(rawRefreshToken: string) {
    const row = await this.db.consumeRefreshToken(rawRefreshToken);
    if (!row || !row.active) throw new UnauthorizedException('Refresh token inválido o vencido');
    return this.issueSession({ id: row.userId, email: row.email, role: row.role, branchId: row.branchId, active: row.active, passwordHash: '' });
  }

  async logout(rawRefreshToken: string) { await this.db.revokeRefreshToken(rawRefreshToken); return { loggedOut: true }; }

  async me(id: string) {
    const user = await this.db.findById(id);
    if (!user || !user.active) throw new UnauthorizedException('Usuario inexistente o inactivo');
    return this.publicUser(user);
  }

  private async issueSession(user: UserRecord) {
    const accessToken = jwt.sign({ sub: user.id, email: user.email, role: user.role, ...(user.branchId ? { branchId: user.branchId } : {}) }, process.env.JWT_SECRET ?? 'dev-only-change-me', { algorithm: 'HS256', issuer: process.env.JWT_ISSUER ?? 'trabajo-pedidos', audience: process.env.JWT_AUDIENCE ?? 'trabajo-pedidos-api', expiresIn: process.env.ACCESS_TOKEN_TTL ?? '2h' } as jwt.SignOptions);
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshDays = Number(process.env.REFRESH_TOKEN_DAYS ?? 7);
    await this.db.saveRefreshToken(user.id, refreshToken, new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000));
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: process.env.ACCESS_TOKEN_TTL ?? '2h', user: this.publicUser(user) };
  }

  private publicUser(user: Pick<UserRecord, 'id' | 'email' | 'role' | 'branchId'>): PublicUser { return { id: user.id, email: user.email, role: user.role, ...(user.branchId ? { branchId: user.branchId } : {}) }; }
}
