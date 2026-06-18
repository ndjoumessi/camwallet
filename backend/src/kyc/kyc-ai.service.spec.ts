import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { KycAiService, KycAnalysisResult } from './kyc-ai.service';

const build = async (apiKey?: string) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      KycAiService,
      {
        provide: ConfigService,
        useValue: { get: jest.fn((k: string) => (k === 'ANTHROPIC_API_KEY' ? apiKey : undefined)) },
      },
    ],
  }).compile();
  return module.get<KycAiService>(KycAiService);
};

// Document « parfait » par défaut, surchargeable par test.
const doc = (over: Partial<KycAnalysisResult> = {}): KycAnalysisResult => ({
  score: 90,
  issues: [],
  readable: true,
  hasFace: true,
  suggestion: 'APPROVE',
  ...over,
});

describe('KycAiService', () => {
  describe('isConfigured', () => {
    it('false sans clé API', async () => {
      expect((await build()).isConfigured()).toBe(false);
    });
    it('true avec clé API', async () => {
      expect((await build('sk-ant-xxx')).isConfigured()).toBe(true);
    });
  });

  describe('analyzeSubmission (agrégation + seuils)', () => {
    // Renvoie recto, verso, selfie dans l'ordre des appels analyzeDocument.
    const mockDocs = (service: KycAiService, recto: KycAnalysisResult, verso: KycAnalysisResult, selfie: KycAnalysisResult) => {
      jest
        .spyOn(service, 'analyzeDocument')
        .mockResolvedValueOnce(recto)
        .mockResolvedValueOnce(verso)
        .mockResolvedValueOnce(selfie);
    };

    const images = { idFront: 'a', idBack: 'b', selfie: 'c' };

    it('APPROVE quand scores élevés et conditions sûres', async () => {
      const service = await build('sk-ant-xxx');
      mockDocs(service, doc({ score: 92 }), doc({ score: 88 }), doc({ score: 95 }));
      const res = await service.analyzeSubmission(images);
      expect(res.suggestion).toBe('APPROVE');
      expect(res.score).toBe(92); // moyenne arrondie
    });

    it('MANUAL_REVIEW quand le score moyen est intermédiaire', async () => {
      const service = await build('sk-ant-xxx');
      mockDocs(service, doc({ score: 60, suggestion: 'MANUAL_REVIEW' }), doc({ score: 70, suggestion: 'MANUAL_REVIEW' }), doc({ score: 65, suggestion: 'MANUAL_REVIEW' }));
      const res = await service.analyzeSubmission(images);
      expect(res.suggestion).toBe('MANUAL_REVIEW');
    });

    it('REJECT quand le score moyen est sous le seuil', async () => {
      const service = await build('sk-ant-xxx');
      mockDocs(service, doc({ score: 20, suggestion: 'REJECT' }), doc({ score: 30, suggestion: 'MANUAL_REVIEW' }), doc({ score: 40 }));
      const res = await service.analyzeSubmission(images);
      expect(res.suggestion).toBe('REJECT');
    });

    it('REJECT si un seul document est rejeté, même avec une bonne moyenne', async () => {
      const service = await build('sk-ant-xxx');
      mockDocs(service, doc({ score: 95, suggestion: 'REJECT', issues: ['Falsification détectée'] }), doc({ score: 95 }), doc({ score: 95 }));
      const res = await service.analyzeSubmission(images);
      expect(res.suggestion).toBe('REJECT');
      expect(res.issues).toContain('Recto : Falsification détectée');
    });

    it('jamais APPROVE si le selfie n\'a pas de visage (garde-fou)', async () => {
      const service = await build('sk-ant-xxx');
      mockDocs(service, doc({ score: 95 }), doc({ score: 95 }), doc({ score: 90, hasFace: false }));
      const res = await service.analyzeSubmission(images);
      expect(res.suggestion).toBe('MANUAL_REVIEW');
    });

    it('jamais APPROVE si une CNI est illisible (garde-fou)', async () => {
      const service = await build('sk-ant-xxx');
      mockDocs(service, doc({ score: 95, readable: false }), doc({ score: 95 }), doc({ score: 95 }));
      const res = await service.analyzeSubmission(images);
      expect(res.suggestion).toBe('MANUAL_REVIEW');
    });

    it('préfixe et agrège les motifs des trois documents', async () => {
      const service = await build('sk-ant-xxx');
      mockDocs(service, doc({ issues: ['flou'] }), doc({ issues: ['MRZ illisible'] }), doc({ issues: ['lunettes'] }));
      const res = await service.analyzeSubmission(images);
      expect(res.issues).toEqual(['Recto : flou', 'Verso : MRZ illisible', 'Selfie : lunettes']);
    });
  });
});
