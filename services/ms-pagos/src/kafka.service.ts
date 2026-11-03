import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Consumer, Kafka, Producer } from 'kafkajs';
import { PaymentEvent } from './database';

type Handler = (event: PaymentEvent) => Promise<void>;

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private readonly kafka = new Kafka({ clientId: process.env.KAFKA_CLIENT_ID ?? 'ms-pagos', brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',') });
  private readonly producer: Producer = this.kafka.producer({ allowAutoTopicCreation: true, idempotent: true });
  private consumer?: Consumer;
  private producerConnected = false;
  private stopping = false;

  async onModuleInit() { void this.connectProducerLoop(); }
  private async connectProducerLoop() { while (!this.stopping && !this.producerConnected) { try { await this.producer.connect(); this.producerConnected = true; this.logger.log('Kafka producer conectado'); } catch (error) { this.logger.warn(`Kafka producer no disponible: ${String(error)}`); await new Promise((resolve) => setTimeout(resolve, 3000)); } } }
  async send(topic: string, key: string, value: PaymentEvent) { if (!this.producerConnected) await this.connectProducerLoop(); await this.producer.send({ topic, messages: [{ key, value: JSON.stringify(value), headers: { 'correlation-id': value.correlationId, 'event-type': value.eventType } }] }); }

  async startCommandConsumer(handler: Handler) {
    if (this.consumer) return;
    this.consumer = this.kafka.consumer({ groupId: process.env.KAFKA_GROUP_ID ?? 'ms-pagos', allowAutoTopicCreation: true });
    try {
      await this.consumer.connect();
      await this.consumer.subscribe({ topic: process.env.KAFKA_COMMAND_TOPIC ?? 'payments.commands.v1', fromBeginning: false });
      await this.consumer.run({ autoCommit: false, eachMessage: async ({ topic, partition, message }) => {
        if (!message.value) return;
        const event = JSON.parse(message.value.toString()) as PaymentEvent;
        let done = false;
        for (let attempt = 1; attempt <= 3 && !done; attempt++) { try { await handler(event); done = true; } catch (error) { this.logger.error({ eventId: event.eventId, attempt, error: String(error) }); if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * attempt)); } }
        if (done) await this.consumer?.commitOffsets([{ topic, partition, offset: (Number(message.offset) + 1).toString() }]);
      } });
    } catch (error) { this.logger.warn(`Kafka consumer no disponible: ${String(error)}`); this.consumer = undefined; if (!this.stopping) setTimeout(() => void this.startCommandConsumer(handler), 5000); }
  }

  async onModuleDestroy() { this.stopping = true; if (this.consumer) await this.consumer.disconnect().catch(() => undefined); if (this.producerConnected) await this.producer.disconnect().catch(() => undefined); }
}
