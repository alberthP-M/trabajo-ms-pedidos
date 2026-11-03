import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { JsonLogger } from './common/json-logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger('ms-pagos') });
  app.enableCors({ origin: true });
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Pagos').setVersion('1.0').build());
  SwaggerModule.setup('docs', app, document);
  await app.listen(Number(process.env.PORT ?? 3003), '0.0.0.0');
}
bootstrap();
