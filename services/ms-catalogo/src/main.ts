import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { JsonLogger } from './common/json-logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger('ms-catalogo') });
  app.enableCors({ origin: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Catálogo').setVersion('1.0').addBearerAuth().build());
  SwaggerModule.setup('docs', app, document);
  await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
}
bootstrap();
