import { Module } from '@nestjs/common';
import { DatabaseService } from './database';
import { HealthController } from './health.controller';
import { KafkaService } from './kafka.service';
import { PagosService } from './pagos.service';
import { StubClient } from './stub.client';

@Module({ controllers: [HealthController], providers: [DatabaseService, KafkaService, StubClient, PagosService] })
export class AppModule {}
