import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { serviceToken } from './common/auth';

@Injectable()
export class CatalogoClient {
  private readonly baseUrl = process.env.MS_CATALOGO_URL ?? process.env.CATALOGO_URL ?? 'http://localhost:3001';
  private async request(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.HTTP_TIMEOUT_MS ?? 2500));
    try {
      const headers = new Headers(init.headers);
      headers.set('content-type', 'application/json');
      headers.set('authorization', `Bearer ${serviceToken()}`);
      const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers, signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`${response.status}: ${body.message ?? body.error ?? 'Catálogo rechazó la solicitud'}`);
      return body;
    } finally { clearTimeout(timer); }
  }

  reserve(orderId: string, branchId: string, items: Array<{ productId: string; quantity: number }>, correlationId: string) {
    return this.request('/v1/reservas', { method: 'POST', headers: { 'x-reservation-id': orderId, 'x-correlation-id': correlationId }, body: JSON.stringify({ branchId, items }) });
  }
  consolidate(orderId: string, correlationId: string) { return this.request(`/v1/reservas/${orderId}/consolidar`, { method: 'POST', headers: { 'x-correlation-id': correlationId } }); }
  release(orderId: string, correlationId: string) { return this.request(`/v1/reservas/${orderId}/liberar`, { method: 'POST', headers: { 'x-correlation-id': correlationId } }); }
}
