import { ConsoleLogger } from '@nestjs/common';

export class JsonLogger extends ConsoleLogger {
  constructor(private readonly serviceName: string) { super(); }
  override log(message: any, context?: string) { process.stdout.write(`${JSON.stringify({ level: 'info', service: this.serviceName, context, message, timestamp: new Date().toISOString() })}\n`); }
  override error(message: any, trace?: string, context?: string) { process.stderr.write(`${JSON.stringify({ level: 'error', service: this.serviceName, context, message, trace, timestamp: new Date().toISOString() })}\n`); }
  override warn(message: any, context?: string) { process.stdout.write(`${JSON.stringify({ level: 'warn', service: this.serviceName, context, message, timestamp: new Date().toISOString() })}\n`); }
}
