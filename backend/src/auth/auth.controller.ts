import { Controller, Get, Post, Patch, Body, Headers, HttpCode, HttpStatus, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { resolveLang } from '../common/i18n/i18n.util';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { SetPinDto } from './dto/set-pin.dto';
import { LoginDto } from './dto/login.dto';
import { LoginAdminDto } from './dto/login-admin.dto';
import { ChangePinDto } from './dto/change-pin.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Inscription — envoi OTP SMS' })
  @ApiResponse({ status: 201, description: 'OTP envoyé' })
  register(@Body() dto: RegisterDto, @Headers('accept-language') acceptLanguage?: string) {
    return this.authService.register(dto, resolveLang(acceptLanguage));
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérification code OTP' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Post('set-pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Création PIN 6 chiffres' })
  setPin(@Body() dto: SetPinDto) {
    return this.authService.setPin(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Connexion avec numéro + PIN' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('login-admin')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Connexion administrateur (email + mot de passe)' })
  loginAdmin(@Body() dto: LoginAdminDto) {
    return this.authService.loginAdmin(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renouveler les tokens via le refresh token' })
  refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refresh(refreshToken);
  }

  @Post('pin-reset/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 2 } })
  @ApiOperation({ summary: 'Demande de reset PIN via SMS' })
  requestPinReset(@Body('phone') phone: string, @Headers('accept-language') acceptLanguage?: string) {
    return this.authService.requestPinReset(phone, resolveLang(acceptLanguage));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Déconnexion — invalide tous les refresh tokens en cours' })
  @ApiResponse({ status: 200, description: 'Déconnexion réussie' })
  logout(@Request() req: any) {
    return this.authService.logout(req.user.id);
  }

  @Patch('change-pin')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Modification du PIN (ancien PIN requis)' })
  @ApiResponse({ status: 200, description: 'PIN modifié' })
  @ApiResponse({ status: 401, description: 'PIN actuel incorrect' })
  changePin(@Request() req: any, @Body() dto: ChangePinDto) {
    return this.authService.changePin(req.user.id, dto.currentPin, dto.newPin);
  }

  @Post('verify-pin')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Vérifier le PIN courant (sans reconnexion)' })
  @ApiResponse({ status: 200, description: 'PIN correct' })
  @ApiResponse({ status: 401, description: 'PIN incorrect' })
  verifyPin(@Request() req: any, @Body('pin') pin: string) {
    return this.authService.verifyPin(req.user.id, pin);
  }

  // ─── 2FA TOTP ─────────────────────────────────────────────────────────────

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initialiser le TOTP 2FA (génère le secret et l\'URL otpauth)' })
  setup2FA(@Request() req: any) {
    return this.authService.setup2FA(req.user.id);
  }

  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Vérifier le code TOTP et activer le 2FA' })
  verify2FA(@Request() req: any, @Body('code') code: string) {
    return this.authService.verify2FA(req.user.id, code);
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Désactiver le 2FA (code TOTP requis)' })
  disable2FA(@Request() req: any, @Body('code') code: string) {
    return this.authService.disable2FA(req.user.id, code);
  }

  @Get('2fa/status')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Statut d\'activation du 2FA TOTP' })
  status2FA(@Request() req: any) {
    return this.authService.get2FAStatus(req.user.id);
  }
}
