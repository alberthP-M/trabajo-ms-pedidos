export class CircuitOpenError extends Error { constructor() { super('Circuit breaker abierto para la pasarela'); } }

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  constructor(private readonly threshold = Number(process.env.CIRCUIT_FAILURE_THRESHOLD ?? 3), private readonly openMs = Number(process.env.CIRCUIT_OPEN_MS ?? 10000)) {}
  get state() { if (this.openedAt && Date.now() - this.openedAt >= this.openMs) return 'half-open'; if (this.openedAt) return 'open'; return 'closed'; }
  async execute<T>(operation: () => Promise<T>) {
    if (this.state === 'open') throw new CircuitOpenError();
    try { const result = await operation(); this.failures = 0; this.openedAt = 0; return result; }
    catch (error) { this.failures++; if (this.failures >= this.threshold) this.openedAt = Date.now(); throw error; }
  }
}
