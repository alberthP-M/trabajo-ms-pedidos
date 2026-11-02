import { Module } from '@nestjs/common';
import { PasarelaController } from './pasarela.controller';
import { PasarelaService } from './pasarela.service';

@Module({ controllers: [PasarelaController], providers: [PasarelaService] })
export class AppModule {}
