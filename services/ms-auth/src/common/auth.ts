import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import jwt, { JwtPayload } from 'jsonwebtoken';

export interface AuthUser extends JwtPayload { sub: string; email: string; role: 'cliente' | 'sucursal'; branchId?: string; }

function readBearer(request: any) {
  const value = request.headers?.authorization;
  if (!value?.startsWith('Bearer ')) throw new UnauthorizedException('Bearer token requerido');
  return value.slice(7);
}

export function verifyAccessToken(request: any): AuthUser {
  try {
    return jwt.verify(readBearer(request), process.env.JWT_SECRET ?? 'dev-only-change-me', { issuer: process.env.JWT_ISSUER ?? 'trabajo-pedidos', audience: process.env.JWT_AUDIENCE ?? 'trabajo-pedidos-api' }) as AuthUser;
  } catch { throw new UnauthorizedException('JWT inválido o vencido'); }
}

@Injectable()
export class JwtGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    request.user = verifyAccessToken(request);
    return true;
  }
}
