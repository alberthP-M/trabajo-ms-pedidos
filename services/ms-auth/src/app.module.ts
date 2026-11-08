import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DatabaseService } from './database';
import { HealthController } from './health.controller';
import { JwtGuard } from './common/auth';

@Module({ controllers: [AuthController, HealthController], providers: [AuthService, DatabaseService, JwtGuard] })
export class AppModule {}
