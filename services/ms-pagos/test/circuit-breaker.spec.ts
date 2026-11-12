import { CircuitBreaker, CircuitOpenError } from '../src/circuit-breaker';

describe('CircuitBreaker', () => {
  it('abre después del umbral y permite recuperación posterior', async () => {
    const breaker = new CircuitBreaker(2, 20);
    await expect(breaker.execute(async () => { throw new Error('caída'); })).rejects.toThrow('caída');
    await expect(breaker.execute(async () => { throw new Error('caída'); })).rejects.toThrow('caída');
    await expect(breaker.execute(async () => 'no debe ejecutarse')).rejects.toBeInstanceOf(CircuitOpenError);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await expect(breaker.execute(async () => 'recuperado')).resolves.toBe('recuperado');
  });
});
