import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { JwtGuard } from './common/auth';
import { AuthService } from './auth.service';

class CredentialsDto { @IsEmail() email!: string; @IsString() @MinLength(8) password!: string; }
class RefreshDto { @IsString() @MinLength(20) refreshToken!: string; }

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register') @ApiOperation({ summary: 'Registra un cliente' })
  register(@Body() body: CredentialsDto) { return this.auth.register(body.email, body.password); }

  @Post('login') @ApiOperation({ summary: 'Inicia sesión y emite tokens' })
  login(@Body() body: CredentialsDto) { return this.auth.login(body.email, body.password); }

  @Post('refresh') @ApiOperation({ summary: 'Rota el refresh token y emite un nuevo access token' })
  refresh(@Body() body: RefreshDto) { return this.auth.refresh(body.refreshToken); }

  @Post('logout') @ApiOperation({ summary: 'Revoca un refresh token' })
  logout(@Body() body: RefreshDto) { return this.auth.logout(body.refreshToken); }

  @Get('me') @UseGuards(JwtGuard) @ApiBearerAuth() @ApiOperation({ summary: 'Obtiene el usuario autenticado' })
  me(@Req() request: any) { return this.auth.me(request.user.sub); }
}
