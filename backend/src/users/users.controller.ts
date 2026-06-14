import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Request,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PushTokenDto } from './dto/push-token.dto';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 Mo

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private cloudinary: CloudinaryService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Profil complet + solde + statistiques' })
  me(@Request() req: any) {
    return this.usersService.getMe(req.user.id);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Mise à jour du profil (nom, email, ville, date de naissance, avatar)' })
  updateProfile(@Request() req: any, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.id, dto);
  }

  @Post('avatar')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload de la photo de profil (Cloudinary)' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_BYTES } }))
  async uploadAvatar(@Request() req: any, @UploadedFile() file: any) {
    if (!file) throw new BadRequestException('Aucun fichier fourni');
    // Le type est validé par signature binaire dans CloudinaryService.
    const url = await this.cloudinary.uploadImage(file.buffer);
    return this.usersService.setAvatar(req.user.id, url);
  }

  @Post('push-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enregistre le jeton de notification push (Expo)' })
  setPushToken(@Request() req: any, @Body() dto: PushTokenDto) {
    return this.usersService.setPushToken(req.user.id, dto.pushToken);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suppression du compte (soft delete — statut DELETED)' })
  deleteAccount(@Request() req: any) {
    return this.usersService.deleteAccount(req.user.id);
  }
}
