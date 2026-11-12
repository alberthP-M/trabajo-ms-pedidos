import { Module } from '@nestjs/common';
import { CatalogoClient } from './catalogo.client';
import { JwtGuard, ClientGuard } from './common/auth';
import { DatabaseService } from './database';
import { HealthController } from './health.controller';
import { KafkaService } from './kafka.service';
import { PedidosController } from './pedidos.controller';
import { PedidosService } from './pedidos.service';

@Module({ controllers: [PedidosController, HealthController], providers: [DatabaseService, KafkaService, CatalogoClient, PedidosService, JwtGuard, ClientGuard] })
export class AppModule {}
