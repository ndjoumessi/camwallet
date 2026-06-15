import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { KycStatus } from '@prisma/client';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private prisma: PrismaService,
    private cloudinary: CloudinaryService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Soumission KYC : CNI recto + verso + selfie. Upload Cloudinary (ou data URI
  // en dev), puis upsert du document et passage du statut à SUBMITTED.
  async submit(
    userId: string,
    files: { idFront?: Buffer; idBack?: Buffer; selfie?: Buffer },
  ) {
    if (!files.idFront || !files.idBack || !files.selfie) {
      throw new BadRequestException('Trois images requises : CNI recto, CNI verso et selfie');
    }

    // Le type est validé par signature binaire dans CloudinaryService.
    const [idFrontUrl, idBackUrl, selfieUrl] = await Promise.all([
      this.cloudinary.uploadImage(files.idFront, 'camwallet/kyc'),
      this.cloudinary.uploadImage(files.idBack, 'camwallet/kyc'),
      this.cloudinary.uploadImage(files.selfie, 'camwallet/kyc'),
    ]);

    await this.prisma.$transaction([
      this.prisma.kycDocument.upsert({
        where: { userId },
        create: { userId, idFrontUrl, idBackUrl, selfieUrl, status: KycStatus.SUBMITTED },
        update: {
          idFrontUrl,
          idBackUrl,
          selfieUrl,
          status: KycStatus.SUBMITTED,
          reviewedBy: null,
          reviewNote: null,
          reviewedAt: null,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { kycStatus: KycStatus.SUBMITTED },
      }),
    ]);

    // Événement temps réel pour le dashboard admin (non bloquant).
    this.eventEmitter.emit('kyc.submitted', { userId });

    this.logger.log(`KYC soumis : ${userId}`);
    return { status: KycStatus.SUBMITTED };
  }

  // Statut KYC de l'utilisateur connecté (pour l'écran mobile).
  async getMyStatus(userId: string) {
    const [user, document] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } }),
      this.prisma.kycDocument.findUnique({
        where: { userId },
        select: { status: true, reviewNote: true, submittedAt: true, reviewedAt: true },
      }),
    ]);
    return { kycStatus: user?.kycStatus ?? 'PENDING', document };
  }
}
