import { Controller, Get, Post, Patch, Body, HttpCode, HttpStatus, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PushTokenDto } from './dto/push-token.dto';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Profil de l\'utilisateur connecté' })
  me(@Request() req: any) {
    return this.usersService.getMe(req.user.id);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Mise à jour du profil (nom, email)' })
  updateProfile(@Request() req: any, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.id, dto);
  }

  @Post('push-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enregistre le jeton de notification push (Expo)' })
  setPushToken(@Request() req: any, @Body() dto: PushTokenDto) {
    return this.usersService.setPushToken(req.user.id, dto.pushToken);
  }
}
