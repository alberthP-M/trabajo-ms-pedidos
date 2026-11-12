import { Body, Controller, ForbiddenException, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ClientGuard, JwtGuard } from './common/auth';
import { PedidosService } from './pedidos.service';

class OrderItemDto { @ApiProperty() @IsString() productId!: string; @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) quantity!: number; }
class CreateOrderDto {
  @ApiProperty() @IsString() branchId!: string;
  @ApiProperty({ type: [OrderItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => OrderItemDto) items!: OrderItemDto[];
  @ApiProperty({ description: 'Token opaco de la pasarela, nunca datos de tarjeta' }) @IsString() paymentToken!: string;
  @ApiPropertyOptional({ default: 'BOB' }) @IsOptional() @IsString() currency?: string;
}

const orderSchema = { type: 'object', required: ['id', 'status', 'branchId', 'items', 'history'], properties: {
  id: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['pendiente', 'confirmado', 'rechazado'] },
  branchId: { type: 'string' }, totalCents: { type: 'integer' }, currency: { type: 'string' },
  rejectionReason: { type: 'string', nullable: true }, correlationId: { type: 'string', format: 'uuid' },
  items: { type: 'array', items: { type: 'object', properties: { productId: { type: 'string' }, quantity: { type: 'integer' }, unitPriceCents: { type: 'integer', nullable: true } } } },
  history: { type: 'array', items: { type: 'object', properties: { toStatus: { type: 'string' }, reason: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } } },
} };

@ApiTags('pedidos')
@ApiBearerAuth()
@Controller('v1/pedidos')
export class PedidosController {
  constructor(private readonly service: PedidosService) {}

  @Post() @UseGuards(ClientGuard) @ApiOperation({ summary: 'Crea un pedido idempotente' }) @ApiResponse({ status: 201, description: 'Pedido pendiente con identificador, estado e historial', schema: orderSchema }) @ApiResponse({ status: 400, description: 'Solicitud inválida o clave de idempotencia reutilizada' })
  create(@Req() req: any, @Headers('idempotency-key') key: string, @Body() body: CreateOrderDto) {
    if (req.user.role !== 'cliente') throw new ForbiddenException('Solo clientes pueden crear pedidos');
    return this.service.create(req.user.sub, body, key);
  }

  @Get() @UseGuards(JwtGuard) @ApiOperation({ summary: 'Lista pedidos visibles para el usuario' }) @ApiResponse({ status: 200, schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, branchId: { type: 'string' }, status: { type: 'string' }, totalCents: { type: 'integer' }, createdAt: { type: 'string', format: 'date-time' } } } } })
  list(@Req() req: any) { return this.service.list(req.user); }

  @Get(':id') @UseGuards(JwtGuard) @ApiOperation({ summary: 'Obtiene un pedido visible para el usuario con historial' }) @ApiResponse({ status: 200, schema: orderSchema }) @ApiResponse({ status: 404, description: 'Pedido inexistente o fuera del alcance del usuario' })
  get(@Req() req: any, @Param('id') id: string) { return this.service.get(id, req.user); }
}
