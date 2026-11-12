import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import jwt, { JwtPayload } from 'jsonwebtoken';

export interface AuthUser extends JwtPayload { sub: string; role: 'cliente' | 'sucursal' | 'service'; branchId?: string; }

function readBearer(request: any) {
  const value = request.headers?.authorization;
  if (!value?.startsWith('Bearer ')) throw new UnauthorizedException('Bearer token requerido');
  return value.slice(7);
}

export function verifyUser(request: any): AuthUser {
  try { return jwt.verify(readBearer(request), process.env.JWT_SECRET ?? 'dev-only-change-me', { issuer: process.env.JWT_ISSUER ?? 'trabajo-pedidos', audience: process.env.JWT_AUDIENCE ?? 'trabajo-pedidos-api' }) as AuthUser; }
  catch { throw new UnauthorizedException('JWT inválido o vencido'); }
}

export function serviceToken() { return jwt.sign({ sub: 'ms-pedidos', role: 'service' }, process.env.SERVICE_JWT_SECRET ?? 'dev-service-only-change-me', { expiresIn: '5m' }); }

@Injectable()
export class JwtGuard implements CanActivate { canActivate(context: ExecutionContext) { const req = context.switchToHttp().getRequest(); req.user = verifyUser(req); return true; } }

@Injectable()
export class ClientGuard implements CanActivate { canActivate(context: ExecutionContext) { const req = context.switchToHttp().getRequest(); req.user = verifyUser(req); if (req.user.role !== 'cliente') throw new ForbiddenException('Solo clientes'); return true; } }
