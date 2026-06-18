import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { KycAiService } from './kyc-ai.service';
import { KycStatus } from '@prisma/client';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private prisma: PrismaService,
    private cloudinary: CloudinaryService,
    private readonly aiService: KycAiService,
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

    // Pré-validation IA (Claude Vision) en arrière-plan — fire-and-forget : ne
    // doit jamais bloquer ni faire échouer la soumission. Persiste le score et
    // la suggestion sur le document KYC une fois l'analyse terminée.
    this.runAiAnalysis(userId, files.idFront, files.idBack, files.selfie);

    this.logger.log(`KYC soumis : ${userId}`);
    return { status: KycStatus.SUBMITTED };
  }

  // Analyse IA non bloquante (lancée après la soumission).
  private runAiAnalysis(userId: string, idFront: Buffer, idBack: Buffer, selfie: Buffer): void {
    if (!this.aiService.isConfigured()) return;

    void this.aiService
      .analyzeSubmission({
        idFront: idFront.toString('base64'),
        idBack: idBack.toString('base64'),
        selfie: selfie.toString('base64'),
      })
      .then(async (res) => {
        await this.prisma.kycDocument.update({
          where: { userId },
          data: {
            aiScore: res.score,
            aiSuggestion: res.suggestion,
            aiIssues: res.issues,
            aiAnalyzedAt: new Date(),
          },
        });
        this.eventEmitter.emit('kyc.ai_analyzed', { userId, suggestion: res.suggestion });
        this.logger.log(`Analyse IA KYC : ${userId} → ${res.suggestion} (${res.score}/100)`);
      })
      .catch((err) =>
        this.logger.error(
          `Analyse IA KYC échouée pour ${userId}`,
          err instanceof Error ? err.stack : String(err),
        ),
      );
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
