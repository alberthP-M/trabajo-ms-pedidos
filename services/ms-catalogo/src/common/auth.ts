import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import jwt, { JwtPayload } from 'jsonwebtoken';

export interface AuthUser extends JwtPayload { sub: string; role: 'cliente' | 'sucursal' | 'service'; branchId?: string; }

function tokenFromRequest(request: any): string {
  const header = request.headers?.authorization;
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Bearer token requerido');
  return header.slice(7);
}

export function verifyUser(request: any): AuthUser {
  try {
    return jwt.verify(tokenFromRequest(request), process.env.JWT_SECRET ?? 'dev-only-change-me', {
      issuer: process.env.JWT_ISSUER ?? 'trabajo-pedidos',
      audience: process.env.JWT_AUDIENCE ?? 'trabajo-pedidos-api',
    }) as AuthUser;
  } catch { throw new UnauthorizedException('JWT inválido o vencido'); }
}

export function verifyService(request: any): AuthUser {
  try {
    return jwt.verify(tokenFromRequest(request), process.env.SERVICE_JWT_SECRET ?? 'dev-service-only-change-me') as AuthUser;
  } catch { throw new UnauthorizedException('JWT de servicio inválido'); }
}

@Injectable()
export class JwtGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    request.user = verifyUser(request);
    return true;
  }
}

@Injectable()
export class ServiceGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    request.user = verifyService(request);
    if (request.user.role !== 'service') throw new ForbiddenException('Solo servicios internos');
    return true;
  }
}
