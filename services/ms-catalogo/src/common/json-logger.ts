import { LoggerService } from '@nestjs/common';

export class JsonLogger implements LoggerService {
  constructor(private readonly service: string) {}

  private write(level: string, message: unknown, context?: string) {
    process.stdout.write(`${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      context,
      message: typeof message === 'string' ? message : message,
    })}\n`);
  }

  log(message: unknown, context?: string) { this.write('info', message, context); }
  error(message: unknown, trace?: string, context?: string) { this.write('error', { message, trace }, context); }
  warn(message: unknown, context?: string) { this.write('warn', message, context); }
  debug(message: unknown, context?: string) { this.write('debug', message, context); }
  verbose(message: unknown, context?: string) { this.write('trace', message, context); }
}
