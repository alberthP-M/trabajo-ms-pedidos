import { Body, Controller, ForbiddenException, Get, Logger, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsPositive, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CatalogoService } from './catalogo.service';
import { JwtGuard, ServiceGuard } from './common/auth';

class ProductDto {
  @ApiPropertyOptional() @IsOptional() @IsString() productId?: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty({ minimum: 1, example: 3500 }) @IsInt() @IsPositive() priceCents!: number;
  @ApiProperty({ minimum: 0, example: 10 }) @IsInt() @Min(0) stockTotal!: number;
}
class StockDto { @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) stockTotal!: number; }
class ReserveItemDto { @ApiProperty() @IsString() productId!: string; @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) quantity!: number; }
class ReserveDto { @ApiProperty() @IsString() branchId!: string; @ApiProperty({ type: [ReserveItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => ReserveItemDto) items!: ReserveItemDto[]; }

@ApiTags('catalogo')
@ApiBearerAuth()
@Controller('v1')
export class CatalogoController {
  private readonly logger = new Logger(CatalogoController.name);
  constructor(private readonly service: CatalogoService) {}

  @Get('sucursales') @UseGuards(JwtGuard) @ApiOperation({ summary: 'Lista sucursales' })
  branches() { return this.service.listBranches(); }

  @Get('sucursales/:branchId/menu') @UseGuards(JwtGuard) @ApiResponse({ status: 200, schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, priceCents: { type: 'integer' }, stockTotal: { type: 'integer' }, availableStock: { type: 'integer' } } } } })
  menu(@Param('branchId') branchId: string) { return this.service.listMenu(branchId); }

  @Post('sucursales/:branchId/productos') @UseGuards(JwtGuard) @ApiResponse({ status: 201, description: 'Producto creado o actualizado' }) @ApiResponse({ status: 403, description: 'Solo la sucursal propietaria puede modificar productos' })
  product(@Param('branchId') branchId: string, @Body() body: ProductDto, @Req() req: any) {
    if (req.user.role !== 'sucursal' || req.user.branchId !== branchId) throw new ForbiddenException('La sucursal del token no coincide');
    return this.service.saveProduct(branchId, body);
  }

  @Put('sucursales/:branchId/productos/:productId/stock') @UseGuards(JwtGuard)
  stock(@Param('branchId') branchId: string, @Param('productId') productId: string, @Body() body: StockDto, @Req() req: any) {
    if (req.user.role !== 'sucursal' || req.user.branchId !== branchId) throw new ForbiddenException('La sucursal del token no coincide');
    return this.service.updateStock(branchId, productId, body.stockTotal);
  }

  @Post('reservas') @UseGuards(ServiceGuard) @ApiResponse({ status: 201, description: 'Reserva creada o recuperada de forma idempotente' })
  async reserve(@Body() body: ReserveDto, @Req() req: any) {
    const orderId = req.headers['x-reservation-id']; const correlationId = req.headers['x-correlation-id'];
    try { const result = await this.service.reserve(orderId, body.branchId, body.items); this.logger.log({ event: 'StockReservado', orderId, correlationId, branchId: body.branchId }); return result; }
    catch (error) { this.logger.warn({ event: 'ReservaFallida', orderId, correlationId, reason: String(error) }); throw error; }
  }

  @Post('reservas/:id/consolidar') @UseGuards(ServiceGuard)
  async consolidate(@Param('id') id: string, @Req() req: any) { const result = await this.service.consolidate(id); this.logger.log({ event: 'StockConsolidado', orderId: id, correlationId: req.headers['x-correlation-id'] }); return result; }

  @Post('reservas/:id/liberar') @UseGuards(ServiceGuard)
  async release(@Param('id') id: string, @Req() req: any) { const result = await this.service.release(id); this.logger.log({ event: 'StockLiberado', orderId: id, correlationId: req.headers['x-correlation-id'] }); return result; }
}
