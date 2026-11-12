import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsInt, IsString, IsUUID, Min } from 'class-validator';
import { PasarelaService } from './pasarela.service';

class AuthorizeDto { @IsString() paymentToken!: string; @IsInt() @Min(1) amountCents!: number; @IsString() currency!: string; @IsUUID() idempotencyKey!: string; }
class ReverseDto { @IsString() paymentId!: string; @IsInt() @Min(1) amountCents!: number; @IsString() currency!: string; @IsString() idempotencyKey!: string; }

@Controller()
export class PasarelaController {
  constructor(private readonly service: PasarelaService) {}
  @Post('authorize') authorize(@Body() body: AuthorizeDto) { return this.service.authorize(body); }
  @Get('operations/:key') operation(@Param('key') key: string) { return this.service.query(key); }
  @Post('reverse') reverse(@Body() body: ReverseDto) { return this.service.reverse(body); }
  @Get('health/live') live() { return { status: 'ok', service: 'pasarela-stub' }; }
}
