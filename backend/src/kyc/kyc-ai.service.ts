import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

export type KycDocType = 'cni_recto' | 'cni_verso' | 'selfie';
export type KycSuggestion = 'APPROVE' | 'REJECT' | 'MANUAL_REVIEW';

export interface KycAnalysisResult {
  score: number; // 0-100
  issues: string[];
  readable: boolean;
  hasFace: boolean;
  suggestion: KycSuggestion;
}

export interface KycAggregateResult {
  score: number; // 0-100, score global agrégé
  issues: string[];
  suggestion: KycSuggestion;
}

export interface KycAiPingResult {
  reachable: boolean;
  latency: number | null;
}

// Seuils de décision (cf. cahier des charges).
const APPROVE_THRESHOLD = 85;
const REJECT_THRESHOLD = 40;

const MODEL = 'claude-opus-4-8';

// Schéma de sortie structurée — garantit un JSON conforme (pas de parsing fragile).
// Pas de contraintes min/max numériques (non supportées) : on borne le score côté code.
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'integer' },
    issues: { type: 'array', items: { type: 'string' } },
    readable: { type: 'boolean' },
    hasFace: { type: 'boolean' },
    suggestion: { type: 'string', enum: ['APPROVE', 'REJECT', 'MANUAL_REVIEW'] },
  },
  required: ['score', 'issues', 'readable', 'hasFace', 'suggestion'],
} as const;

const SYSTEM_PROMPT =
  "Tu es un analyste KYC pour CamWallet (Cameroun). Tu examines des photos de pièces " +
  "d'identité (CNI camerounaise) et des selfies pour pré-valider l'identité avant " +
  "revue humaine. Sois rigoureux : signale toute illisibilité, découpe, retouche, " +
  'reflet, ou incohérence. Tu n\'es PAS l\'autorité finale — un agent humain tranchera. ' +
  'Renvoie uniquement la structure demandée, en français pour les motifs (issues).';

// Consignes spécifiques par type de document.
const PROMPTS: Record<KycDocType, string> = {
  cni_recto:
    "Analyse ce RECTO de CNI camerounaise. Vérifie : lisibilité globale ; présence et " +
    'lisibilité du nom, prénom, date de naissance et numéro de la pièce ; absence de découpe, ' +
    'masquage ou falsification visible. `readable`=true si les champs clés sont lisibles. ' +
    '`hasFace`=true si la photo d\'identité du titulaire est visible. Liste chaque anomalie dans `issues`.',
  cni_verso:
    "Analyse ce VERSO de CNI camerounaise. Vérifie : lisibilité globale ; présence de " +
    "l'adresse et de la zone MRZ (lignes de caractères en bas) ; cohérence apparente avec un " +
    'recto officiel ; absence de retouche. `readable`=true si l\'adresse et la MRZ sont lisibles. ' +
    '`hasFace`=false attendu (pas de visage au verso). Liste chaque anomalie dans `issues`.',
  selfie:
    'Analyse ce SELFIE. Vérifie : présence d\'un visage humain clair et net ; bonne luminosité ; ' +
    'visage non masqué (pas de lunettes de soleil, masque, main). `hasFace`=true si un visage ' +
    'clair est présent. `readable` reflète la qualité/netteté de l\'image. Liste chaque anomalie dans `issues`.',
};

/**
 * Pré-validation KYC par Claude Vision (API Anthropic).
 *
 * Lancée en arrière-plan à la soumission : analyse chaque image et agrège un
 * score + une suggestion (APPROVE / REJECT / MANUAL_REVIEW) que l'agent KYC
 * peut appliquer en un clic. Inactif si `ANTHROPIC_API_KEY` n'est pas configuré.
 */
@Injectable()
export class KycAiService {
  private readonly logger = new Logger(KycAiService.name);
  private client: Anthropic | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Vrai quand l'API Anthropic est configurée (clé présente). */
  isConfigured(): boolean {
    return !!this.config.get<string>('ANTHROPIC_API_KEY');
  }

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: this.config.get<string>('ANTHROPIC_API_KEY') });
    }
    return this.client;
  }

  /**
   * Ping l'API Anthropic via l'endpoint Models (lecture seule, sans coût
   * d'inférence) : valide la clé et la disponibilité. Sert au tableau de bord
   * « Santé des intégrations ».
   */
  async ping(): Promise<KycAiPingResult> {
    if (!this.isConfigured()) return { reachable: false, latency: null };
    const start = Date.now();
    try {
      await this.getClient().models.retrieve(MODEL);
      return { reachable: true, latency: Date.now() - start };
    } catch (err) {
      this.logger.error('Ping Anthropic échoué', err instanceof Error ? err.stack : String(err));
      return { reachable: false, latency: null };
    }
  }

  // Détecte le type MIME d'après les octets de signature (base64 décodé).
  private detectMediaType(imageBase64: string): 'image/png' | 'image/jpeg' | 'image/webp' {
    const buf = Buffer.from(imageBase64.slice(0, 24), 'base64');
    if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return 'image/jpeg'; // défaut raisonnable (JPEG) si non identifié
  }

  /**
   * Analyse un document KYC unique via Claude Vision.
   * @param imageBase64 image encodée en base64 (sans préfixe data URI)
   */
  async analyzeDocument(imageBase64: string, type: KycDocType): Promise<KycAnalysisResult> {
    const message = await this.getClient().messages.create({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: this.detectMediaType(imageBase64), data: imageBase64 },
            },
            { type: 'text', text: PROMPTS[type] },
          ],
        },
      ],
    });

    // La sortie structurée garantit un bloc texte JSON conforme au schéma.
    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Réponse IA sans contenu texte');
    }
    const parsed = JSON.parse(textBlock.text) as KycAnalysisResult;

    return {
      score: Math.max(0, Math.min(100, Math.round(parsed.score))),
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      readable: !!parsed.readable,
      hasFace: !!parsed.hasFace,
      suggestion: parsed.suggestion,
    };
  }

  /**
   * Analyse les trois images d'une soumission et agrège un verdict global.
   * Garde-fou : jamais d'auto-APPROVE si une CNI est illisible ou le selfie sans visage.
   */
  async analyzeSubmission(images: {
    idFront: string;
    idBack: string;
    selfie: string;
  }): Promise<KycAggregateResult> {
    const [recto, verso, selfie] = await Promise.all([
      this.analyzeDocument(images.idFront, 'cni_recto'),
      this.analyzeDocument(images.idBack, 'cni_verso'),
      this.analyzeDocument(images.selfie, 'selfie'),
    ]);

    const score = Math.round((recto.score + verso.score + selfie.score) / 3);

    const issues = [
      ...recto.issues.map((i) => `Recto : ${i}`),
      ...verso.issues.map((i) => `Verso : ${i}`),
      ...selfie.issues.map((i) => `Selfie : ${i}`),
    ];

    // Conditions minimales pour envisager une approbation automatique.
    const safeToApprove = recto.readable && verso.readable && selfie.hasFace;
    const anyReject = [recto, verso, selfie].some((r) => r.suggestion === 'REJECT');

    let suggestion: KycSuggestion;
    if (anyReject || score < REJECT_THRESHOLD) {
      suggestion = 'REJECT';
    } else if (score >= APPROVE_THRESHOLD && safeToApprove) {
      suggestion = 'APPROVE';
    } else {
      suggestion = 'MANUAL_REVIEW';
    }

    return { score, issues, suggestion };
  }
}
