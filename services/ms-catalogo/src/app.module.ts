import { Module } from '@nestjs/common';
import { CatalogoController } from './catalogo.controller';
import { CatalogoService } from './catalogo.service';
import { DatabaseService } from './database';
import { HealthController } from './health.controller';
import { JwtGuard, ServiceGuard } from './common/auth';

@Module({ controllers: [CatalogoController, HealthController], providers: [DatabaseService, CatalogoService, JwtGuard, ServiceGuard] })
export class AppModule {}
